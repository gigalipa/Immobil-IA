use chrono::Utc;
use ort::{session::Session, value::Tensor};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::{
    path::PathBuf,
    sync::{Mutex as StdMutex, OnceLock},
};
use tauri::{Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug)]
struct AppState {
    db: Mutex<SqlitePool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UserProfile {
    id: String,
    email: String,
    name: String,
    phone: String,
    city: String,
    country: String,
    plan: String,
    accepted_terms: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Radar {
    id: String,
    name: String,
    keywords: Vec<String>,
    country: String,
    zone: String,
    frequency: String,
    is_active: bool,
    last_run_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MessageTemplate {
    id: String,
    name: String,
    body: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentRunSummary {
    id: String,
    radar_id: String,
    started_at: String,
    finished_at: Option<String>,
    status: String,
    publications_count: i64,
    leads_count: i64,
    matches_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapData {
    user: Option<UserProfile>,
    radars: Vec<Radar>,
    properties: Vec<Value>,
    leads: Vec<Value>,
    matches: Vec<Value>,
    templates: Vec<MessageTemplate>,
    last_run: Option<AgentRunSummary>,
}

#[tauri::command]
async fn bootstrap(state: State<'_, AppState>) -> Result<BootstrapData, String> {
    let db = state.db.lock().await;
    load_bootstrap_data(&db).await
}

#[tauri::command]
async fn save_user(state: State<'_, AppState>, user: UserProfile) -> Result<UserProfile, String> {
    let db = state.db.lock().await;
    sqlx::query(
        r#"
        INSERT INTO users (id, email, name, phone, city, country, plan, accepted_terms)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            name = excluded.name,
            phone = excluded.phone,
            city = excluded.city,
            country = excluded.country,
            plan = excluded.plan,
            accepted_terms = excluded.accepted_terms
        "#,
    )
    .bind(&user.id)
    .bind(&user.email)
    .bind(&user.name)
    .bind(&user.phone)
    .bind(&user.city)
    .bind(&user.country)
    .bind(&user.plan)
    .bind(user.accepted_terms)
    .execute(&*db)
    .await
    .map_err(|error| error.to_string())?;

    seed_defaults(&db).await?;
    Ok(user)
}

#[tauri::command]
async fn save_radar(state: State<'_, AppState>, radar: Radar) -> Result<Radar, String> {
    let db = state.db.lock().await;
    let keywords = serde_json::to_string(&radar.keywords).map_err(|error| error.to_string())?;
    sqlx::query(
        r#"
        INSERT INTO radars_ws (id, name, keywords, country, zone, frequency, is_active, last_run_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            keywords = excluded.keywords,
            country = excluded.country,
            zone = excluded.zone,
            frequency = excluded.frequency,
            is_active = excluded.is_active,
            last_run_at = excluded.last_run_at
        "#,
    )
    .bind(&radar.id)
    .bind(&radar.name)
    .bind(keywords)
    .bind(&radar.country)
    .bind(&radar.zone)
    .bind(&radar.frequency)
    .bind(radar.is_active)
    .bind(&radar.last_run_at)
    .execute(&*db)
    .await
    .map_err(|error| error.to_string())?;

    Ok(radar)
}

#[tauri::command]
async fn create_manual_entity(
    state: State<'_, AppState>,
    kind: String,
    data: Value,
) -> Result<Value, String> {
    let db = state.db.lock().await;
    match kind.as_str() {
        "property" => {
            let payload = normalize_publication_payload(data, None);
            insert_publication(&db, None, &payload).await?;
            Ok(payload)
        }
        "lead" => {
            let payload = normalize_lead_payload(data, None);
            insert_lead(&db, None, &payload).await?;
            Ok(payload)
        }
        _ => Err("Tipo de entidad no soportado".to_string()),
    }
}

#[tauri::command]
async fn update_match_status(
    state: State<'_, AppState>,
    id: String,
    status: String,
) -> Result<String, String> {
    let db = state.db.lock().await;
    let existing = sqlx::query(
        r#"
        SELECT id, status, property_id, comparison_property_id, lead_id, payload
        FROM matches
        WHERE id = ?1
        LIMIT 1
        "#,
    )
    .bind(&id)
    .fetch_optional(&*db)
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "No se encontro la sugerencia de match".to_string())?;

    let previous_status: String = existing.get("status");
    let payload_json: Option<String> = existing.get("payload");
    let payload = payload_json
        .as_deref()
        .and_then(|payload| serde_json::from_str::<Value>(payload).ok())
        .unwrap_or_else(|| json!({ "id": id }));

    sqlx::query(
        r#"
        UPDATE matches
        SET status = ?2,
            updated_at = datetime('now')
        WHERE id = ?1
        "#,
    )
    .bind(&id)
    .bind(&status)
    .execute(&*db)
    .await
    .map_err(|error| error.to_string())?;

    record_feedback_event(
        &db,
        &id,
        &status,
        &previous_status,
        &payload,
        existing.get("property_id"),
        existing.get("comparison_property_id"),
        existing.get("lead_id"),
    )
    .await?;
    sync_pending_feedback(&db).await.ok();

    Ok(status)
}

async fn record_feedback_event(
    pool: &SqlitePool,
    match_id: &str,
    decision: &str,
    previous_status: &str,
    match_payload: &Value,
    property_id: Option<String>,
    comparison_property_id: Option<String>,
    lead_id: Option<String>,
) -> Result<(), String> {
    let kind = feedback_kind(match_payload);
    let confidence = match_payload
        .get("similarity")
        .and_then(|similarity| similarity.get("confidence"))
        .and_then(Value::as_f64);
    let source = string_field(match_payload, &["source"]).unwrap_or_else(|| {
        if match_payload.get("comparisonProperty").is_some() {
            "PostComparer".to_string()
        } else {
            "MatchMaker".to_string()
        }
    });
    let event_payload = json!({
        "matchId": match_id,
        "source": source,
        "previousStatus": previous_status,
        "decision": decision,
        "propertyId": property_id,
        "comparisonPropertyId": comparison_property_id,
        "leadId": lead_id,
        "confidence": confidence,
        "createdLocallyAt": Utc::now().to_rfc3339()
    });
    let event_payload = serde_json::to_string(&event_payload).map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO feedback_events (id, kind, entity_id, decision, payload, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(kind)
    .bind(match_id)
    .bind(decision)
    .bind(event_payload)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn record_feedback(
    state: State<'_, AppState>,
    kind: String,
    entity_id: String,
    decision: String,
    payload: Value,
) -> Result<(), String> {
    let db = state.db.lock().await;
    let event_payload = serde_json::to_string(&payload).map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO feedback_events (id, kind, entity_id, decision, payload, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(kind)
    .bind(entity_id)
    .bind(decision)
    .bind(event_payload)
    .execute(&*db)
    .await
    .map_err(|error| error.to_string())?;

    sync_pending_feedback(&db).await.ok();
    Ok(())
}

#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Solo se pueden abrir enlaces http o https".to_string());
    }
    open::that(trimmed).map_err(|error| error.to_string())
}

fn feedback_kind(match_payload: &Value) -> &'static str {
    match string_field(match_payload, &["source"]).as_deref() {
        Some("MatchMaker") => "matchmaker_match",
        Some("PostComparer") => "post_comparer_relation",
        _ if match_payload.get("comparisonProperty").is_some() => "post_comparer_relation",
        _ => "matchmaker_match",
    }
}

#[tauri::command]
async fn save_template(
    state: State<'_, AppState>,
    template: MessageTemplate,
) -> Result<MessageTemplate, String> {
    let db = state.db.lock().await;
    sqlx::query(
        r#"
        INSERT INTO templates (id, name, body, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            body = excluded.body,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&template.id)
    .bind(&template.name)
    .bind(&template.body)
    .bind(&template.updated_at)
    .execute(&*db)
    .await
    .map_err(|error| error.to_string())?;

    Ok(template)
}

#[tauri::command]
async fn run_radar(state: State<'_, AppState>, radar_id: String) -> Result<BootstrapData, String> {
    let run_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339();
    let radar = {
        let db = state.db.lock().await;
        let radar = load_radar_by_id(&db, &radar_id)
            .await?
            .ok_or_else(|| "Radar no encontrado".to_string())?;
        insert_agent_run_started(&db, &run_id, &radar_id, &started_at).await?;
        radar
    };

    let user_id = {
        let db = state.db.lock().await;
        sync_user_id(&db).await?
    };
    let known_urls = {
        let db = state.db.lock().await;
        load_known_document_urls(&db).await?
    };
    let proxy = request_proxy_token(&user_id, &radar).await.ok().flatten();
    let mut request_payload = json!({
        "keywords": radar.keywords,
        "country": radar.country,
        "zone": radar.zone,
        "nlpProvider": configured_nlp_provider(),
        "knownUrls": known_urls,
    });
    if let Some(proxy) = proxy {
        request_payload["proxy"] = proxy;
    }

    let agent_url = scraper_agent_url();
    let response_result = reqwest::Client::new()
        .post(format!("{agent_url}/scrape/{radar_id}"))
        .json(&request_payload)
        .send()
        .await
        .map_err(|error| format!("No se pudo contactar el Agente WS local: {error}"));

    let response = match response_result {
        Ok(response) => response
            .error_for_status()
            .map_err(|error| format!("El Agente WS respondio con error: {error}"))?
            .json::<Value>()
            .await
            .map_err(|error| error.to_string())?,
        Err(error) => {
            let db = state.db.lock().await;
            update_agent_run_finished(&db, &run_id, "error", 0, 0, 0, Some(&error), None).await?;
            return Err(error);
        }
    };

    let db = state.db.lock().await;
    let (publications_count, leads_count) =
        persist_scrape_response(&db, &radar_id, &response).await?;
    let matches_before = count_matches(&db).await?;
    generate_post_comparer_matches(&db).await?;
    generate_matchmaker_matches(&db).await?;
    let matches_after = count_matches(&db).await?;
    let matches_count = (matches_after - matches_before).max(0);
    sqlx::query("UPDATE radars_ws SET last_run_at = datetime('now') WHERE id = ?1")
        .bind(&radar_id)
        .execute(&*db)
        .await
        .map_err(|error| error.to_string())?;
    update_agent_run_finished(
        &db,
        &run_id,
        "completed",
        publications_count,
        leads_count,
        matches_count,
        None,
        Some(&response),
    )
    .await?;
    sync_pending_agent_runs(&db).await.ok();
    sync_pending_feedback(&db).await.ok();

    load_bootstrap_data(&db).await
}

async fn init_database(path: PathBuf) -> Result<SqlitePool, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            city TEXT NOT NULL,
            country TEXT NOT NULL,
            plan TEXT NOT NULL,
            accepted_terms INTEGER NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS radars_ws (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            keywords TEXT NOT NULL,
            country TEXT NOT NULL,
            zone TEXT NOT NULL,
            frequency TEXT NOT NULL,
            is_active INTEGER NOT NULL,
            last_run_at TEXT
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS publications (
            id TEXT PRIMARY KEY,
            radar_id TEXT,
            title TEXT NOT NULL,
            source TEXT NOT NULL,
            location TEXT NOT NULL,
            price INTEGER NOT NULL DEFAULT 0,
            area_m2 REAL NOT NULL DEFAULT 0,
            rooms INTEGER NOT NULL DEFAULT 0,
            lat REAL NOT NULL DEFAULT 0,
            lng REAL NOT NULL DEFAULT 0,
            image_url TEXT NOT NULL,
            owner_name TEXT,
            owner_phone TEXT,
            owner_email TEXT,
            url TEXT,
            raw_text TEXT,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS property_groups (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            location TEXT NOT NULL,
            representative_publication_id TEXT,
            certainty REAL,
            source TEXT NOT NULL DEFAULT 'Sin comparar',
            status TEXT NOT NULL DEFAULT 'Sin comparar',
            payload TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS leads (
            id TEXT PRIMARY KEY,
            radar_id TEXT,
            name TEXT NOT NULL,
            role TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            looking_for TEXT NOT NULL,
            budget INTEGER NOT NULL DEFAULT 0,
            location TEXT NOT NULL,
            property_id TEXT,
            property_summary TEXT,
            source_url TEXT,
            raw_text TEXT,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            body TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS matches (
            id TEXT PRIMARY KEY,
            property_id TEXT,
            comparison_property_id TEXT,
            lead_id TEXT,
            payload TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS feedback_events (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            decision TEXT NOT NULL,
            payload TEXT,
            synced_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_runs (
            id TEXT PRIMARY KEY,
            radar_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            status TEXT NOT NULL,
            publications_count INTEGER NOT NULL DEFAULT 0,
            leads_count INTEGER NOT NULL DEFAULT 0,
            errors TEXT,
            response_payload TEXT
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;

    migrate_existing_tables(&pool).await?;

    seed_defaults(&pool).await?;
    Ok(pool)
}

async fn migrate_existing_tables(pool: &SqlitePool) -> Result<(), String> {
    add_column_if_missing(pool, "leads", "radar_id", "TEXT").await?;
    add_column_if_missing(pool, "leads", "name", "TEXT").await?;
    add_column_if_missing(pool, "leads", "role", "TEXT").await?;
    add_column_if_missing(pool, "leads", "phone", "TEXT").await?;
    add_column_if_missing(pool, "leads", "email", "TEXT").await?;
    add_column_if_missing(pool, "leads", "address", "TEXT").await?;
    add_column_if_missing(pool, "leads", "looking_for", "TEXT").await?;
    add_column_if_missing(pool, "leads", "budget", "INTEGER").await?;
    add_column_if_missing(pool, "leads", "location", "TEXT").await?;
    add_column_if_missing(pool, "leads", "property_id", "TEXT").await?;
    add_column_if_missing(pool, "leads", "property_summary", "TEXT").await?;
    add_column_if_missing(pool, "leads", "source_url", "TEXT").await?;
    add_column_if_missing(pool, "leads", "raw_text", "TEXT").await?;
    add_column_if_missing(pool, "leads", "updated_at", "TEXT").await?;

    add_column_if_missing(pool, "matches", "property_id", "TEXT").await?;
    add_column_if_missing(pool, "matches", "comparison_property_id", "TEXT").await?;
    add_column_if_missing(pool, "matches", "lead_id", "TEXT").await?;
    add_column_if_missing(pool, "matches", "payload", "TEXT").await?;
    add_column_if_missing(pool, "matches", "created_at", "TEXT").await?;
    add_column_if_missing(pool, "agent_runs", "synced_at", "TEXT").await?;
    add_column_if_missing(pool, "agent_runs", "matches_count", "INTEGER NOT NULL DEFAULT 0").await?;

    migrate_legacy_properties(pool).await?;
    Ok(())
}

async fn add_column_if_missing(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let pragma = format!("PRAGMA table_info({table})");
    let rows = sqlx::query(&pragma)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    let exists = rows
        .iter()
        .any(|row| row.get::<String, _>("name") == column);

    if !exists {
        let alter = format!("ALTER TABLE {table} ADD COLUMN {column} {definition}");
        sqlx::query(&alter)
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

async fn migrate_legacy_properties(pool: &SqlitePool) -> Result<(), String> {
    let table_exists = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'properties' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())?
    .is_some();

    if !table_exists {
        return Ok(());
    }

    let rows = sqlx::query("SELECT payload FROM properties")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    for row in rows {
        let payload: String = row.get("payload");
        if let Ok(value) = serde_json::from_str::<Value>(&payload) {
            let normalized = normalize_publication_payload(value, None);
            insert_publication(pool, None, &normalized).await?;
        }
    }

    Ok(())
}

async fn seed_defaults(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO radars_ws
            (id, name, keywords, country, zone, frequency, is_active, last_run_at)
        VALUES
            ('radar-chapinero', 'Chapinero apartamentos', '["apartamento","venta","chapinero"]', 'Colombia', 'Bogota - Chapinero', 'Semanal', 1, NULL)
        "#,
    )
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        INSERT OR IGNORE INTO templates (id, name, body, updated_at)
        VALUES (
            'tpl-401',
            'Primer contacto WhatsApp',
            'Hola [Nombre_Lead], soy [Nombre_Agente]. Vi que buscas [Tipo_Inmueble] en [Zona]. Tengo una opcion cercana por [Precio]. Te puedo compartir detalles?',
            datetime('now')
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn load_user(pool: &SqlitePool) -> Result<Option<UserProfile>, String> {
    let row = sqlx::query("SELECT * FROM users LIMIT 1")
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())?;

    Ok(row.map(|row| UserProfile {
        id: row.get("id"),
        email: row.get("email"),
        name: row.get("name"),
        phone: row.get("phone"),
        city: row.get("city"),
        country: row.get("country"),
        plan: row.get("plan"),
        accepted_terms: row.get::<bool, _>("accepted_terms"),
    }))
}

async fn load_radars(pool: &SqlitePool) -> Result<Vec<Radar>, String> {
    let rows = sqlx::query("SELECT * FROM radars_ws ORDER BY name")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    rows.into_iter()
        .map(|row| {
            let keywords: String = row.get("keywords");
            Ok(Radar {
                id: row.get("id"),
                name: row.get("name"),
                keywords: serde_json::from_str(&keywords).map_err(|error| error.to_string())?,
                country: row.get("country"),
                zone: row.get("zone"),
                frequency: row.get("frequency"),
                is_active: row.get::<bool, _>("is_active"),
                last_run_at: row.get("last_run_at"),
            })
        })
        .collect()
}

async fn load_templates(pool: &SqlitePool) -> Result<Vec<MessageTemplate>, String> {
    let rows = sqlx::query("SELECT * FROM templates ORDER BY updated_at DESC")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| MessageTemplate {
            id: row.get("id"),
            name: row.get("name"),
            body: row.get("body"),
            updated_at: row.get("updated_at"),
        })
        .collect())
}

async fn load_bootstrap_data(pool: &SqlitePool) -> Result<BootstrapData, String> {
    Ok(BootstrapData {
        user: load_user(pool).await?,
        radars: load_radars(pool).await?,
        properties: load_publications(pool).await?,
        leads: load_leads(pool).await?,
        matches: load_matches(pool).await?,
        templates: load_templates(pool).await?,
        last_run: load_last_agent_run(pool).await?,
    })
}

async fn load_radar_by_id(pool: &SqlitePool, radar_id: &str) -> Result<Option<Radar>, String> {
    let row = sqlx::query("SELECT * FROM radars_ws WHERE id = ?1 LIMIT 1")
        .bind(radar_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())?;

    row.map(|row| {
        let keywords: String = row.get("keywords");
        Ok(Radar {
            id: row.get("id"),
            name: row.get("name"),
            keywords: serde_json::from_str(&keywords).map_err(|error| error.to_string())?,
            country: row.get("country"),
            zone: row.get("zone"),
            frequency: row.get("frequency"),
            is_active: row.get::<bool, _>("is_active"),
            last_run_at: row.get("last_run_at"),
        })
    })
    .transpose()
}

async fn load_publications(pool: &SqlitePool) -> Result<Vec<Value>, String> {
    let rows = sqlx::query("SELECT payload FROM publications ORDER BY updated_at DESC")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    rows.into_iter()
        .map(|row| {
            let payload: String = row.get("payload");
            serde_json::from_str(&payload).map_err(|error| error.to_string())
        })
        .collect()
}

async fn load_leads(pool: &SqlitePool) -> Result<Vec<Value>, String> {
    let rows = sqlx::query("SELECT payload FROM leads ORDER BY updated_at DESC")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    rows.into_iter()
        .map(|row| {
            let payload: String = row.get("payload");
            serde_json::from_str(&payload).map_err(|error| error.to_string())
        })
        .collect()
}

async fn load_known_document_urls(pool: &SqlitePool) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        r#"
        SELECT url AS url FROM publications WHERE url IS NOT NULL AND trim(url) != ''
        UNION
        SELECT source_url AS url FROM leads WHERE source_url IS NOT NULL AND trim(source_url) != ''
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("url").ok())
        .collect())
}

async fn load_matches(pool: &SqlitePool) -> Result<Vec<Value>, String> {
    let rows = sqlx::query(
        "SELECT payload, status FROM matches WHERE payload IS NOT NULL ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    rows.into_iter()
        .map(|row| {
            let payload: String = row.get("payload");
            let status: String = row.get("status");
            let mut value: Value =
                serde_json::from_str(&payload).map_err(|error| error.to_string())?;
            if let Some(object) = value.as_object_mut() {
                object.insert("status".to_string(), Value::String(status));
            }
            Ok(value)
        })
        .collect()
}

async fn load_last_agent_run(pool: &SqlitePool) -> Result<Option<AgentRunSummary>, String> {
    let row = sqlx::query(
        r#"
        SELECT
            id,
            radar_id,
            started_at,
            finished_at,
            status,
            publications_count,
            leads_count,
            matches_count
        FROM agent_runs
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(row.map(|row| AgentRunSummary {
        id: row.get("id"),
        radar_id: row.get("radar_id"),
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
        status: row.get("status"),
        publications_count: row.get("publications_count"),
        leads_count: row.get("leads_count"),
        matches_count: row.get("matches_count"),
    }))
}

async fn persist_scrape_response(
    pool: &SqlitePool,
    radar_id: &str,
    response: &Value,
) -> Result<(i64, i64), String> {
    let mut publications_count = 0;
    let mut leads_count = 0;

    if let Some(documents) = response.get("documents").and_then(Value::as_array) {
        for document in documents {
            let kind = document
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_else(|| infer_document_kind(document));

            if kind == "lead" {
                let payload = normalize_lead_payload(document.clone(), None);
                let is_new = entity_is_new(pool, "leads", &payload).await?;
                insert_lead(pool, Some(radar_id), &payload).await?;
                if is_new {
                    leads_count += 1;
                }
            } else {
                let payload = normalize_publication_payload(document.clone(), None);
                let is_new = entity_is_new(pool, "publications", &payload).await?;
                insert_publication(pool, Some(radar_id), &payload).await?;
                if is_new {
                    publications_count += 1;
                }
            }
        }
    }

    if let Some(publications) = response.get("publications").and_then(Value::as_array) {
        for publication in publications {
            let payload = normalize_publication_payload(publication.clone(), None);
            let is_new = entity_is_new(pool, "publications", &payload).await?;
            insert_publication(pool, Some(radar_id), &payload).await?;
            if is_new {
                publications_count += 1;
            }
        }
    }

    if let Some(leads) = response.get("leads").and_then(Value::as_array) {
        for lead in leads {
            let payload = normalize_lead_payload(lead.clone(), None);
            let is_new = entity_is_new(pool, "leads", &payload).await?;
            insert_lead(pool, Some(radar_id), &payload).await?;
            if is_new {
                leads_count += 1;
            }
        }
    }

    Ok((publications_count, leads_count))
}

async fn entity_is_new(pool: &SqlitePool, table: &str, payload: &Value) -> Result<bool, String> {
    let id = string_field(payload, &["id"]).ok_or_else(|| "El documento requiere id".to_string())?;
    let query = match table {
        "leads" => "SELECT 1 FROM leads WHERE id = ?1 LIMIT 1",
        "publications" => "SELECT 1 FROM publications WHERE id = ?1 LIMIT 1",
        _ => return Err("Tabla de documento no soportada".to_string()),
    };

    let existing = sqlx::query(query)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())?;

    Ok(existing.is_none())
}

async fn generate_post_comparer_matches(pool: &SqlitePool) -> Result<i64, String> {
    let publications = load_publications(pool).await?;
    let leads = load_leads(pool).await?;
    if publications.len() < 2 || leads.is_empty() {
        return Ok(0);
    }

    let mut inserted = 0;
    for first_index in 0..publications.len() {
        for second_index in (first_index + 1)..publications.len() {
            let first = &publications[first_index];
            let second = &publications[second_index];
            let similarity = compare_publications(first, second);

            if similarity.confidence < 72.0 {
                continue;
            }

            let Some(lead) = choose_match_lead(&leads, first, second) else {
                continue;
            };
            let Some(match_id) = post_comparer_match_id(first, second) else {
                continue;
            };

            let payload = json!({
                "id": match_id,
                "source": "PostComparer",
                "property": first,
                "comparisonProperty": second,
                "lead": lead,
                "similarity": {
                    "gps": similarity.gps.round(),
                    "visual": similarity.visual.round(),
                    "features": similarity.features.round(),
                    "confidence": similarity.confidence.round()
                },
                "modelRuntime": similarity.runtime,
                "modelPath": similarity.model_path,
                "status": "Pendiente"
            });

            insert_match_suggestion(pool, &payload).await?;
            inserted += 1;
        }
    }

    Ok(inserted)
}

async fn generate_matchmaker_matches(pool: &SqlitePool) -> Result<i64, String> {
    let publications = load_publications(pool).await?;
    let leads = load_leads(pool).await?;
    if publications.is_empty() || leads.is_empty() {
        return Ok(0);
    }

    clear_pending_matchmaker_matches(pool).await?;
    let inventory = build_matchmaker_inventory(pool, publications).await?;
    let mut inserted = 0;
    for lead in leads.iter().filter(|lead| is_demand_lead(lead)) {
        let mut scored = inventory
            .iter()
            .map(|property| (property, compare_lead_to_property(lead, property)))
            .filter(|(property, score)| {
                score.confidence >= 58.0 && transaction_intent_score(lead, property) >= 70.0
            })
            .collect::<Vec<_>>();

        scored.sort_by(|(_, left), (_, right)| {
            right
                .confidence
                .partial_cmp(&left.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        for (property, score) in scored.into_iter().take(3) {
            let Some(match_id) = matchmaker_match_id(lead, property) else {
                continue;
            };

            let payload = json!({
                "id": match_id,
                "source": "MatchMaker",
                "property": property,
                "lead": lead,
                "similarity": {
                    "gps": score.gps.round(),
                    "visual": score.visual.round(),
                    "features": score.features.round(),
                    "confidence": score.confidence.round()
                },
                "modelRuntime": score.runtime,
                "modelPath": score.model_path,
                "status": "Pendiente"
            });

            insert_match_suggestion(pool, &payload).await?;
            inserted += 1;
        }
    }

    Ok(inserted)
}

async fn clear_pending_matchmaker_matches(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        r#"
        DELETE FROM matches
        WHERE status = 'Pendiente'
          AND (
            id LIKE 'matchmaker-%'
            OR json_extract(payload, '$.source') = 'MatchMaker'
          )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn build_matchmaker_inventory(
    pool: &SqlitePool,
    publications: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let relation_rows = sqlx::query(
        r#"
        SELECT property_id, comparison_property_id
        FROM matches
        WHERE status != 'Rechazado'
          AND comparison_property_id IS NOT NULL
          AND (
            id LIKE 'postcmp-%'
            OR json_extract(payload, '$.source') = 'PostComparer'
            OR json_extract(payload, '$.comparisonProperty.id') IS NOT NULL
          )
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    let ids = publications
        .iter()
        .filter_map(|publication| string_field(publication, &["id"]))
        .collect::<Vec<_>>();
    let mut disjoint_set = StringDisjointSet::new(ids);

    for row in relation_rows {
        let property_id: Option<String> = row.get("property_id");
        let comparison_property_id: Option<String> = row.get("comparison_property_id");
        if let (Some(property_id), Some(comparison_property_id)) = (property_id, comparison_property_id) {
            disjoint_set.union(&property_id, &comparison_property_id);
        }
    }

    let mut buckets = std::collections::BTreeMap::<String, Vec<Value>>::new();
    for publication in publications {
        let Some(id) = string_field(&publication, &["id"]) else {
            continue;
        };
        let root = disjoint_set.find(&id);
        buckets.entry(root).or_default().push(publication);
    }

    Ok(buckets
        .into_values()
        .filter_map(consolidate_property_group)
        .collect())
}

fn consolidate_property_group(publications: Vec<Value>) -> Option<Value> {
    let representative = publications
        .iter()
        .max_by(|left, right| {
            property_representative_score(left)
                .partial_cmp(&property_representative_score(right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })?
        .clone();

    if publications.len() == 1 {
        return Some(representative);
    }

    let property_group_id = publications
        .iter()
        .filter_map(|publication| string_field(publication, &["id"]))
        .collect::<Vec<_>>()
        .join("-");
    let mut object = representative.as_object().cloned().unwrap_or_default();
    object.insert(
        "propertyGroupId".to_string(),
        Value::String(format!("group-{property_group_id}")),
    );
    object.insert(
        "title".to_string(),
        Value::String(
            string_field(&representative, &["title"])
                .unwrap_or_else(|| "Inmueble consolidado".to_string()),
        ),
    );
    object.insert(
        "publicationIds".to_string(),
        Value::Array(
            publications
                .iter()
                .filter_map(|publication| string_field(publication, &["id"]).map(Value::String))
                .collect(),
        ),
    );
    object.insert(
        "publicationCount".to_string(),
        Value::Number((publications.len() as i64).into()),
    );

    Some(Value::Object(object))
}

fn property_representative_score(property: &Value) -> f64 {
    let source = string_field(property, &["source"]).unwrap_or_default();
    let source_score = match source.as_str() {
        "Manual" => 30.0,
        "Scraper" | "Fuente controlada" => 20.0,
        _ => 10.0,
    };
    let completeness = [
        string_field(property, &["title"]).is_some(),
        string_field(property, &["ownerPhone", "owner_phone"]).is_some(),
        string_field(property, &["imageUrl", "image_url"]).is_some(),
        i64_field(property, &["price"]).unwrap_or(0) > 0,
        f64_field(property, &["areaM2", "area", "area_m2"]).unwrap_or(0.0) > 0.0,
    ]
    .into_iter()
    .filter(|has_value| *has_value)
    .count() as f64;

    source_score + completeness
}

#[derive(Debug)]
struct StringDisjointSet {
    parent: std::collections::BTreeMap<String, String>,
}

impl StringDisjointSet {
    fn new(ids: Vec<String>) -> Self {
        Self {
            parent: ids
                .into_iter()
                .map(|id| {
                    let parent = id.clone();
                    (id, parent)
                })
                .collect(),
        }
    }

    fn find(&mut self, id: &str) -> String {
        if !self.parent.contains_key(id) {
            self.parent.insert(id.to_string(), id.to_string());
        }
        let current = self
            .parent
            .get(id)
            .cloned()
            .unwrap_or_else(|| id.to_string());
        if current == id {
            return current;
        }
        let root = self.find(&current);
        self.parent.insert(id.to_string(), root.clone());
        root
    }

    fn union(&mut self, first: &str, second: &str) {
        let first_root = self.find(first);
        let second_root = self.find(second);
        if first_root != second_root {
            self.parent.insert(second_root, first_root);
        }
    }
}

async fn insert_match_suggestion(pool: &SqlitePool, payload: &Value) -> Result<(), String> {
    let id = string_field(payload, &["id"]).ok_or_else(|| "El match requiere id".to_string())?;
    let property_id = payload
        .get("property")
        .and_then(|property| string_field(property, &["id"]));
    let comparison_property_id = payload
        .get("comparisonProperty")
        .and_then(|property| string_field(property, &["id"]));
    let lead_id = payload
        .get("lead")
        .and_then(|lead| string_field(lead, &["id"]));
    let payload_json = serde_json::to_string(payload).map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO matches (
            id, property_id, comparison_property_id, lead_id, payload, status, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, 'Pendiente', datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            property_id = excluded.property_id,
            comparison_property_id = excluded.comparison_property_id,
            lead_id = excluded.lead_id,
            payload = excluded.payload,
            status = matches.status,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(id)
    .bind(property_id)
    .bind(comparison_property_id)
    .bind(lead_id)
    .bind(payload_json)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[derive(Debug)]
struct SimilarityScore {
    gps: f64,
    visual: f64,
    features: f64,
    confidence: f64,
    runtime: &'static str,
    model_path: Option<String>,
}

fn compare_publications(first: &Value, second: &Value) -> SimilarityScore {
    if let Some(score) = run_onnx_score(ModelKind::PostComparer, &post_comparer_features(first, second)) {
        return score;
    }

    let gps = gps_similarity(first, second);
    let visual = visual_similarity(first, second);
    let feature_score = average(&[
        zone_similarity(first, second),
        numeric_similarity(first, second, &["price"], 0.18),
        numeric_similarity(first, second, &["areaM2", "area", "area_m2"], 0.16),
        room_similarity(first, second),
        text_similarity(first, second),
    ]);
    let confidence = (gps * 0.30) + (visual * 0.40) + (feature_score * 0.30);

    SimilarityScore {
        gps,
        visual,
        features: feature_score,
        confidence,
        runtime: "deterministic",
        model_path: None,
    }
}

fn compare_lead_to_property(lead: &Value, property: &Value) -> SimilarityScore {
    if let Some(score) = run_onnx_score(ModelKind::MatchMaker, &matchmaker_features(lead, property)) {
        return score;
    }

    let location = lead_location_score(lead, property);
    let budget = lead_budget_score(lead, property);
    let intent = transaction_intent_score(lead, property);
    let features = average(&[
        text_feature_score(lead, property),
        room_demand_score(lead, property),
        area_demand_score(lead, property),
    ]);
    let confidence = (location * 0.35) + (budget * 0.25) + (intent * 0.15) + (features * 0.25);

    SimilarityScore {
        gps: location,
        visual: intent,
        features,
        confidence,
        runtime: "deterministic",
        model_path: None,
    }
}

#[derive(Debug, Clone, Copy)]
enum ModelKind {
    PostComparer,
    MatchMaker,
}

struct OnnxModel {
    session: StdMutex<Session>,
    path: PathBuf,
}

static POST_COMPARER_MODEL: OnceLock<Option<OnnxModel>> = OnceLock::new();
static MATCHMAKER_MODEL: OnceLock<Option<OnnxModel>> = OnceLock::new();

fn run_onnx_score(kind: ModelKind, features: &[f32]) -> Option<SimilarityScore> {
    let model = onnx_model(kind).as_ref()?;
    let input = Tensor::from_array(([1, features.len()], features.to_vec())).ok()?;
    let mut session = model.session.lock().ok()?;
    let outputs = session.run(ort::inputs!["input" => input]).ok()?;
    let (_, scores) = outputs.get("scores")?.try_extract_tensor::<f32>().ok()?;
    if scores.len() < 4 {
        return None;
    }

    Some(SimilarityScore {
        gps: f64::from(scores[0]).clamp(0.0, 100.0),
        visual: f64::from(scores[1]).clamp(0.0, 100.0),
        features: f64::from(scores[2]).clamp(0.0, 100.0),
        confidence: f64::from(scores[3]).clamp(0.0, 100.0),
        runtime: "onnx",
        model_path: Some(model.path.display().to_string()),
    })
}

fn onnx_model(kind: ModelKind) -> &'static Option<OnnxModel> {
    match kind {
        ModelKind::PostComparer => POST_COMPARER_MODEL.get_or_init(|| {
            load_onnx_model("IMMOBILIA_POST_COMPARER_MODEL_PATH", "post_comparer.onnx")
        }),
        ModelKind::MatchMaker => MATCHMAKER_MODEL.get_or_init(|| {
            load_onnx_model("IMMOBILIA_MATCHMAKER_MODEL_PATH", "matchmaker.onnx")
        }),
    }
}

fn load_onnx_model(env_var: &str, default_file_name: &str) -> Option<OnnxModel> {
    let path = resolve_model_path(env_var, default_file_name)?;
    let session = Session::builder().ok()?.commit_from_file(&path).ok()?;
    Some(OnnxModel {
        session: StdMutex::new(session),
        path,
    })
}

fn resolve_model_path(env_var: &str, default_file_name: &str) -> Option<PathBuf> {
    if let Ok(raw_path) = std::env::var(env_var) {
        let trimmed = raw_path.trim();
        if !trimmed.is_empty() {
            let configured = PathBuf::from(trimmed);
            let absolute = if configured.is_absolute() {
                configured
            } else {
                std::env::current_dir().ok()?.join(configured)
            };
            if absolute.exists() {
                return Some(absolute);
            }
        }
    }

    let current_dir = std::env::current_dir().ok();
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from));
    let candidates = [
        current_dir
            .as_ref()
            .map(|path| path.join("models").join(default_file_name)),
        current_dir
            .as_ref()
            .map(|path| path.join("..").join("models").join(default_file_name)),
        executable_dir
            .as_ref()
            .map(|path| path.join("models").join(default_file_name)),
        executable_dir
            .as_ref()
            .map(|path| path.join("..").join("..").join("models").join(default_file_name)),
    ];

    candidates
        .into_iter()
        .flatten()
        .find(|path| path.exists())
}

fn post_comparer_features(first: &Value, second: &Value) -> Vec<f32> {
    vec![
        distance_km_normalized(first, second),
        normalized_score(zone_similarity(first, second)),
        normalized_score(numeric_similarity(first, second, &["price"], 0.18)),
        normalized_score(numeric_similarity(first, second, &["areaM2", "area", "area_m2"], 0.16)),
        normalized_score(room_similarity(first, second)),
        normalized_score(text_similarity(first, second)),
        normalized_score(text_jaccard_fields(first, second, &["location"])),
        owner_phone_match(first, second),
        normalized_score(owner_name_similarity(first, second)),
        both_have_field(first, second, &["imageUrl", "image_url"]),
        source_reliability(first),
        source_reliability(second),
    ]
}

fn matchmaker_features(lead: &Value, property: &Value) -> Vec<f32> {
    let publication_count = i64_field(property, &["publicationCount", "publication_count"])
        .or_else(|| {
            property
                .get("publicationIds")
                .and_then(Value::as_array)
                .map(|ids| ids.len() as i64)
        })
        .unwrap_or(1)
        .max(1);
    let property_certainty = f64_field(property, &["certainty"])
        .map(normalized_score)
        .unwrap_or(if publication_count > 1 { 1.0 } else { 0.5 });

    vec![
        normalized_score(lead_location_score(lead, property)),
        normalized_score(lead_budget_score(lead, property)),
        normalized_score(transaction_intent_score(lead, property)),
        normalized_score(text_feature_score(lead, property)),
        normalized_score(room_demand_score(lead, property)),
        normalized_score(area_demand_score(lead, property)),
        has_field(lead, &["phone"]),
        has_field(lead, &["email"]),
        has_field(property, &["ownerPhone", "owner_phone"]),
        has_field(property, &["ownerEmail", "owner_email"]),
        ((publication_count as f32) / 4.0).clamp(0.0, 1.0),
        property_certainty,
        normalize_market_money(i64_field(property, &["price"]).unwrap_or(0)),
        normalize_market_money(i64_field(lead, &["budget"]).unwrap_or(0)),
    ]
}

fn normalized_score(score: f64) -> f32 {
    (score / 100.0).clamp(0.0, 1.0) as f32
}

fn distance_km_normalized(first: &Value, second: &Value) -> f32 {
    let Some(first_lat) = f64_field(first, &["lat"]) else {
        return 0.5;
    };
    let Some(first_lng) = f64_field(first, &["lng", "lon"]) else {
        return 0.5;
    };
    let Some(second_lat) = f64_field(second, &["lat"]) else {
        return 0.5;
    };
    let Some(second_lng) = f64_field(second, &["lng", "lon"]) else {
        return 0.5;
    };

    (haversine_km(first_lat, first_lng, second_lat, second_lng) * 0.35).clamp(0.0, 1.0) as f32
}

fn text_jaccard_fields(first: &Value, second: &Value, keys: &[&str]) -> f64 {
    let first_text = string_field(first, keys).unwrap_or_default();
    let second_text = string_field(second, keys).unwrap_or_default();
    jaccard_similarity(&first_text, &second_text)
}

fn owner_phone_match(first: &Value, second: &Value) -> f32 {
    string_field(first, &["ownerPhone", "owner_phone"])
        .zip(string_field(second, &["ownerPhone", "owner_phone"]))
        .map(|(first_phone, second_phone)| {
            if normalize_digits(&first_phone) == normalize_digits(&second_phone) {
                1.0
            } else {
                0.0
            }
        })
        .unwrap_or(0.0)
}

fn owner_name_similarity(first: &Value, second: &Value) -> f64 {
    let first_name = string_field(first, &["ownerName", "owner_name"]).unwrap_or_default();
    let second_name = string_field(second, &["ownerName", "owner_name"]).unwrap_or_default();
    jaccard_similarity(&first_name, &second_name)
}

fn both_have_field(first: &Value, second: &Value, keys: &[&str]) -> f32 {
    if has_field(first, keys) > 0.0 && has_field(second, keys) > 0.0 {
        1.0
    } else {
        0.0
    }
}

fn has_field(value: &Value, keys: &[&str]) -> f32 {
    string_field(value, keys)
        .filter(|field| !field.trim().is_empty())
        .map(|_| 1.0)
        .unwrap_or(0.0)
}

fn source_reliability(value: &Value) -> f32 {
    match string_field(value, &["source"]).as_deref() {
        Some("Manual") => 1.0,
        Some("Scraper") | Some("Portal") | Some("Fuente controlada") => 0.85,
        Some("Red social") => 0.70,
        Some(_) => 0.60,
        None => 0.50,
    }
}

fn normalize_market_money(value: i64) -> f32 {
    if value <= 0 {
        return 0.0;
    }
    let value = value as f32;
    if value <= 20_000_000.0 {
        (value / 20_000_000.0).clamp(0.0, 1.0)
    } else {
        (value / 1_500_000_000.0).clamp(0.0, 1.0)
    }
}

fn choose_match_lead<'a>(leads: &'a [Value], first: &Value, second: &Value) -> Option<&'a Value> {
    leads
        .iter()
        .map(|lead| {
            let location_score = lead_location_score(lead, first).max(lead_location_score(lead, second));
            let budget_score = lead_budget_score(lead, first).max(lead_budget_score(lead, second));
            let text_score = lead_text_score(lead, first).max(lead_text_score(lead, second));
            let role_score = match string_field(lead, &["role"]).as_deref() {
                Some("Comprador") | Some("Arrendatario") => 100.0,
                Some("Propietario") | Some("Arrendador") => 35.0,
                _ => 70.0,
            };
            let score = (location_score * 0.35)
                + (budget_score * 0.25)
                + (text_score * 0.25)
                + (role_score * 0.15);
            (lead, score)
        })
        .filter(|(_, score)| *score >= 45.0)
        .max_by(|(_, left), (_, right)| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(lead, _)| lead)
}

fn post_comparer_match_id(first: &Value, second: &Value) -> Option<String> {
    let mut ids = [
        string_field(first, &["id"])?,
        string_field(second, &["id"])?,
    ];
    ids.sort();
    Some(format!("postcmp-{}-{}", ids[0], ids[1]))
}

fn matchmaker_match_id(lead: &Value, property: &Value) -> Option<String> {
    Some(format!(
        "matchmaker-{}-{}",
        string_field(lead, &["id"])?,
        string_field(property, &["id"])?
    ))
}

fn is_demand_lead(lead: &Value) -> bool {
    match string_field(lead, &["role"]).as_deref() {
        Some("Comprador") | Some("Arrendatario") => true,
        Some("Propietario") | Some("Arrendador") => false,
        _ => {
            let text = string_field(lead, &["lookingFor", "looking_for", "rawText", "raw_text"])
                .unwrap_or_default()
                .to_lowercase();
            text.contains("busco")
                || text.contains("busca")
                || text.contains("necesito")
                || text.contains("quiero")
                || text.contains("compro")
                || text.contains("arriendo")
        }
    }
}

fn gps_similarity(first: &Value, second: &Value) -> f64 {
    let Some(first_lat) = f64_field(first, &["lat"]) else {
        return 50.0;
    };
    let Some(first_lng) = f64_field(first, &["lng", "lon"]) else {
        return 50.0;
    };
    let Some(second_lat) = f64_field(second, &["lat"]) else {
        return 50.0;
    };
    let Some(second_lng) = f64_field(second, &["lng", "lon"]) else {
        return 50.0;
    };
    let distance = haversine_km(first_lat, first_lng, second_lat, second_lng);
    (100.0 - (distance * 35.0)).clamp(0.0, 100.0)
}

fn visual_similarity(first: &Value, second: &Value) -> f64 {
    let first_image = string_field(first, &["imageUrl", "image_url"]);
    let second_image = string_field(second, &["imageUrl", "image_url"]);
    if first_image.is_some() && first_image == second_image {
        return 100.0;
    }

    let same_owner_phone = string_field(first, &["ownerPhone", "owner_phone"])
        .zip(string_field(second, &["ownerPhone", "owner_phone"]))
        .map(|(first_phone, second_phone)| normalize_digits(&first_phone) == normalize_digits(&second_phone))
        .unwrap_or(false);
    if same_owner_phone {
        return 88.0;
    }

    if first_image.is_some() && second_image.is_some() {
        62.0
    } else {
        45.0
    }
}

fn zone_similarity(first: &Value, second: &Value) -> f64 {
    let first_zone = normalized_string_field(first, &["location"]);
    let second_zone = normalized_string_field(second, &["location"]);
    match (first_zone, second_zone) {
        (Some(first_zone), Some(second_zone)) if first_zone == second_zone => 100.0,
        (Some(first_zone), Some(second_zone))
            if first_zone.contains(&second_zone) || second_zone.contains(&first_zone) =>
        {
            85.0
        }
        (Some(_), Some(_)) => 20.0,
        _ => 50.0,
    }
}

fn numeric_similarity(first: &Value, second: &Value, keys: &[&str], tolerance: f64) -> f64 {
    let Some(first_value) = f64_field(first, keys) else {
        return 50.0;
    };
    let Some(second_value) = f64_field(second, keys) else {
        return 50.0;
    };
    if first_value <= 0.0 || second_value <= 0.0 {
        return 50.0;
    }

    let ratio = (first_value - second_value).abs() / first_value.max(second_value);
    (100.0 - ((ratio / tolerance) * 100.0)).clamp(0.0, 100.0)
}

fn room_similarity(first: &Value, second: &Value) -> f64 {
    let first_rooms = i64_field(first, &["rooms", "bedrooms"]).unwrap_or(0);
    let second_rooms = i64_field(second, &["rooms", "bedrooms"]).unwrap_or(0);
    if first_rooms == 0 || second_rooms == 0 {
        return 50.0;
    }
    match (first_rooms - second_rooms).abs() {
        0 => 100.0,
        1 => 65.0,
        _ => 20.0,
    }
}

fn text_similarity(first: &Value, second: &Value) -> f64 {
    let first_text = [
        string_field(first, &["title"]),
        string_field(first, &["rawText", "raw_text"]),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");
    let second_text = [
        string_field(second, &["title"]),
        string_field(second, &["rawText", "raw_text"]),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");

    jaccard_similarity(&first_text, &second_text)
}

fn lead_location_score(lead: &Value, property: &Value) -> f64 {
    let lead_location = normalized_string_field(lead, &["location"]);
    let property_location = normalized_string_field(property, &["location"]);
    match (lead_location, property_location) {
        (Some(lead_location), Some(property_location)) if lead_location == property_location => 100.0,
        (Some(lead_location), Some(property_location))
            if lead_location.contains(&property_location) || property_location.contains(&lead_location) =>
        {
            80.0
        }
        (Some(_), Some(_)) => 20.0,
        _ => 45.0,
    }
}

fn lead_budget_score(lead: &Value, property: &Value) -> f64 {
    let budget = i64_field(lead, &["budget"]).unwrap_or(0);
    let price = i64_field(property, &["price"]).unwrap_or(0);
    if budget <= 0 || price <= 0 {
        return 50.0;
    }
    if budget >= price {
        return 100.0;
    }
    let shortfall = (price - budget) as f64 / price as f64;
    (100.0 - (shortfall * 180.0)).clamp(0.0, 100.0)
}

fn lead_text_score(lead: &Value, property: &Value) -> f64 {
    let lead_text = string_field(lead, &["lookingFor", "looking_for", "rawText", "raw_text"])
        .unwrap_or_default();
    let property_text = [
        string_field(property, &["title"]),
        string_field(property, &["rawText", "raw_text"]),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");

    jaccard_similarity(&lead_text, &property_text)
}

fn transaction_intent_score(lead: &Value, property: &Value) -> f64 {
    let lead_text = lead_search_text(lead);
    let property_text = property_search_text(property);
    let role = string_field(lead, &["role"]);

    let wants_rent = role.as_deref() == Some("Arrendatario")
        || contains_any(&lead_text, &["arriendo", "arrendar", "alquiler", "rentar"]);
    let wants_buy = role.as_deref() == Some("Comprador")
        || contains_any(&lead_text, &["compra", "comprar", "compro"]);
    let property_rent = contains_any(&property_text, &["arriendo", "arrienda", "alquiler", "canon"]);
    let property_sale = contains_any(&property_text, &["venta", "vende", "comprar"]);

    if wants_rent && property_rent {
        100.0
    } else if wants_buy && property_sale {
        100.0
    } else if !wants_rent && !wants_buy {
        70.0
    } else if !property_rent && !property_sale {
        65.0
    } else {
        15.0
    }
}

fn text_feature_score(lead: &Value, property: &Value) -> f64 {
    let lead_text = lead_search_text(lead);
    let property_text = property_search_text(property);
    jaccard_similarity(&lead_text, &property_text)
}

fn room_demand_score(lead: &Value, property: &Value) -> f64 {
    let text = lead_search_text(lead);
    let Some(wanted_rooms) = detect_requested_rooms(&text) else {
        return 65.0;
    };
    let property_rooms = i64_field(property, &["rooms", "bedrooms"]).unwrap_or(0);
    if property_rooms <= 0 {
        return 55.0;
    }

    match (wanted_rooms - property_rooms).abs() {
        0 => 100.0,
        1 => 65.0,
        _ => 20.0,
    }
}

fn area_demand_score(lead: &Value, property: &Value) -> f64 {
    let text = lead_search_text(lead);
    let Some((min_area, max_area)) = detect_area_range(&text) else {
        return 65.0;
    };
    let area = f64_field(property, &["areaM2", "area", "area_m2"]).unwrap_or(0.0);
    if area <= 0.0 {
        return 55.0;
    }
    if area >= min_area && area <= max_area {
        return 100.0;
    }

    let distance = if area < min_area {
        min_area - area
    } else {
        area - max_area
    };
    (100.0 - (distance * 3.0)).clamp(0.0, 100.0)
}

fn lead_search_text(lead: &Value) -> String {
    [
        string_field(lead, &["lookingFor", "looking_for"]),
        string_field(lead, &["rawText", "raw_text"]),
        string_field(lead, &["propertySummary", "property_summary"]),
        string_field(lead, &["location"]),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ")
    .to_lowercase()
}

fn property_search_text(property: &Value) -> String {
    [
        string_field(property, &["title"]),
        string_field(property, &["rawText", "raw_text"]),
        string_field(property, &["location"]),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ")
    .to_lowercase()
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn detect_requested_rooms(text: &str) -> Option<i64> {
    let tokens = text.split_whitespace().collect::<Vec<_>>();
    for (index, token) in tokens.iter().enumerate() {
        let normalized = token.trim_matches(|character: char| !character.is_ascii_digit());
        let Ok(value) = normalized.parse::<i64>() else {
            continue;
        };
        let next = tokens.get(index + 1).copied().unwrap_or_default();
        let previous = index
            .checked_sub(1)
            .and_then(|previous_index| tokens.get(previous_index))
            .copied()
            .unwrap_or_default();
        if contains_any(next, &["habitacion", "habitaciones", "alcoba", "alcobas", "hab"])
            || contains_any(previous, &["habitacion", "habitaciones", "alcoba", "alcobas", "hab"])
        {
            return Some(value);
        }
    }
    None
}

fn detect_area_range(text: &str) -> Option<(f64, f64)> {
    let numbers = text
        .split(|character: char| !character.is_ascii_digit())
        .filter_map(|token| token.parse::<f64>().ok())
        .filter(|number| *number >= 20.0 && *number <= 500.0)
        .collect::<Vec<_>>();

    if numbers.len() >= 2 && contains_any(text, &["m2", "mt2", "metros"]) {
        let min = numbers[0].min(numbers[1]);
        let max = numbers[0].max(numbers[1]);
        Some((min, max))
    } else {
        None
    }
}

fn jaccard_similarity(first: &str, second: &str) -> f64 {
    let first_tokens = tokenize(first);
    let second_tokens = tokenize(second);
    if first_tokens.is_empty() || second_tokens.is_empty() {
        return 50.0;
    }

    let intersection = first_tokens
        .iter()
        .filter(|token| second_tokens.contains(*token))
        .count();
    let union = first_tokens.len() + second_tokens.len() - intersection;
    if union == 0 {
        50.0
    } else {
        ((intersection as f64 / union as f64) * 100.0).clamp(0.0, 100.0)
    }
}

fn tokenize(text: &str) -> Vec<String> {
    let stop_words = [
        "para", "con", "por", "los", "las", "una", "uno", "del", "que", "hay", "muy", "cerca",
        "zona", "ideal",
    ];
    let mut tokens = text
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| token.len() > 2 && !stop_words.contains(token))
        .map(str::to_string)
        .collect::<Vec<_>>();
    tokens.sort();
    tokens.dedup();
    tokens
}

fn haversine_km(first_lat: f64, first_lng: f64, second_lat: f64, second_lng: f64) -> f64 {
    let earth_radius_km = 6371.0;
    let d_lat = (second_lat - first_lat).to_radians();
    let d_lng = (second_lng - first_lng).to_radians();
    let first_lat = first_lat.to_radians();
    let second_lat = second_lat.to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + first_lat.cos() * second_lat.cos() * (d_lng / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    earth_radius_km * c
}

fn average(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len() as f64
}

fn normalized_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    string_field(value, keys).map(|text| text.to_lowercase().trim().to_string())
}

fn normalize_digits(text: &str) -> String {
    text.chars()
        .filter(|character| character.is_ascii_digit())
        .collect()
}

async fn insert_publication(
    pool: &SqlitePool,
    radar_id: Option<&str>,
    payload: &Value,
) -> Result<(), String> {
    let id =
        string_field(payload, &["id"]).ok_or_else(|| "La publicacion requiere id".to_string())?;
    let payload_json = serde_json::to_string(payload).map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO publications (
            id, radar_id, title, source, location, price, area_m2, rooms, lat, lng,
            image_url, owner_name, owner_phone, owner_email, url, raw_text, payload,
            created_at, updated_at
        )
        VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
            ?11, ?12, ?13, ?14, ?15, ?16, ?17, datetime('now'), datetime('now')
        )
        ON CONFLICT(id) DO UPDATE SET
            radar_id = excluded.radar_id,
            title = excluded.title,
            source = excluded.source,
            location = excluded.location,
            price = excluded.price,
            area_m2 = excluded.area_m2,
            rooms = excluded.rooms,
            lat = excluded.lat,
            lng = excluded.lng,
            image_url = excluded.image_url,
            owner_name = excluded.owner_name,
            owner_phone = excluded.owner_phone,
            owner_email = excluded.owner_email,
            url = excluded.url,
            raw_text = excluded.raw_text,
            payload = excluded.payload,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(id)
    .bind(radar_id)
    .bind(string_field(payload, &["title"]).unwrap_or_else(|| "Publicacion sin titulo".to_string()))
    .bind(string_field(payload, &["source"]).unwrap_or_else(|| "Scraper".to_string()))
    .bind(string_field(payload, &["location"]).unwrap_or_else(|| "Sin zona".to_string()))
    .bind(i64_field(payload, &["price"]).unwrap_or(0))
    .bind(f64_field(payload, &["areaM2", "area", "area_m2"]).unwrap_or(0.0))
    .bind(i64_field(payload, &["rooms", "bedrooms"]).unwrap_or(0))
    .bind(f64_field(payload, &["lat"]).unwrap_or(0.0))
    .bind(f64_field(payload, &["lng", "lon"]).unwrap_or(0.0))
    .bind(string_field(payload, &["imageUrl", "image_url"]).unwrap_or_else(default_property_image))
    .bind(string_field(payload, &["ownerName", "owner_name"]))
    .bind(string_field(payload, &["ownerPhone", "owner_phone"]))
    .bind(string_field(payload, &["ownerEmail", "owner_email"]))
    .bind(string_field(payload, &["url", "sourceUrl", "source_url"]))
    .bind(string_field(payload, &["rawText", "raw_text"]))
    .bind(payload_json)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn insert_lead(
    pool: &SqlitePool,
    radar_id: Option<&str>,
    payload: &Value,
) -> Result<(), String> {
    let id = string_field(payload, &["id"]).ok_or_else(|| "El lead requiere id".to_string())?;
    let payload_json = serde_json::to_string(payload).map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO leads (
            id, radar_id, name, role, phone, email, address, looking_for, budget,
            location, property_id, property_summary, source_url, raw_text, payload,
            created_at, updated_at
        )
        VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13, ?14, ?15, datetime('now'), datetime('now')
        )
        ON CONFLICT(id) DO UPDATE SET
            radar_id = excluded.radar_id,
            name = excluded.name,
            role = excluded.role,
            phone = excluded.phone,
            email = excluded.email,
            address = excluded.address,
            looking_for = excluded.looking_for,
            budget = excluded.budget,
            location = excluded.location,
            property_id = excluded.property_id,
            property_summary = excluded.property_summary,
            source_url = excluded.source_url,
            raw_text = excluded.raw_text,
            payload = excluded.payload,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(id)
    .bind(radar_id)
    .bind(string_field(payload, &["name"]).unwrap_or_else(|| "Lead detectado".to_string()))
    .bind(string_field(payload, &["role"]))
    .bind(string_field(payload, &["phone"]))
    .bind(string_field(payload, &["email"]))
    .bind(string_field(payload, &["address"]))
    .bind(
        string_field(payload, &["lookingFor", "looking_for"])
            .unwrap_or_else(|| "Busqueda inmobiliaria".to_string()),
    )
    .bind(i64_field(payload, &["budget"]).unwrap_or(0))
    .bind(string_field(payload, &["location"]).unwrap_or_else(|| "Sin zona".to_string()))
    .bind(string_field(payload, &["propertyId", "property_id"]))
    .bind(string_field(
        payload,
        &["propertySummary", "property_summary"],
    ))
    .bind(string_field(payload, &["sourceUrl", "source_url", "url"]))
    .bind(string_field(payload, &["rawText", "raw_text"]))
    .bind(payload_json)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn insert_agent_run_started(
    pool: &SqlitePool,
    run_id: &str,
    radar_id: &str,
    started_at: &str,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO agent_runs (id, radar_id, started_at, status)
        VALUES (?1, ?2, ?3, 'running')
        "#,
    )
    .bind(run_id)
    .bind(radar_id)
    .bind(started_at)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

async fn update_agent_run_finished(
    pool: &SqlitePool,
    run_id: &str,
    status: &str,
    publications_count: i64,
    leads_count: i64,
    matches_count: i64,
    errors: Option<&str>,
    response_payload: Option<&Value>,
) -> Result<(), String> {
    let response_json = response_payload
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
        UPDATE agent_runs
        SET finished_at = ?2,
            status = ?3,
            publications_count = ?4,
            leads_count = ?5,
            matches_count = ?6,
            errors = ?7,
            response_payload = ?8
        WHERE id = ?1
        "#,
    )
    .bind(run_id)
    .bind(Utc::now().to_rfc3339())
    .bind(status)
    .bind(publications_count)
    .bind(leads_count)
    .bind(matches_count)
    .bind(errors)
    .bind(response_json)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn sync_pending_feedback(pool: &SqlitePool) -> Result<usize, String> {
    let Some(api_url) = admin_api_url() else {
        return Ok(0);
    };
    let user_id = sync_user_id(pool).await?;
    let rows = sqlx::query(
        r#"
        SELECT id, kind, entity_id, decision, payload, created_at
        FROM feedback_events
        WHERE synced_at IS NULL
        ORDER BY created_at
        LIMIT 50
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    if rows.is_empty() {
        return Ok(0);
    }

    let mut ids = Vec::with_capacity(rows.len());
    let mut events = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.get("id");
        let payload: Option<String> = row.get("payload");
        ids.push(id.clone());
        events.push(json!({
            "id": id,
            "kind": row.get::<String, _>("kind"),
            "entityId": row.get::<String, _>("entity_id"),
            "decision": row.get::<String, _>("decision"),
            "payload": payload
                .as_deref()
                .and_then(|payload| serde_json::from_str::<Value>(payload).ok())
                .unwrap_or_else(|| json!({})),
            "createdAt": row.get::<String, _>("created_at")
        }));
    }

    let response = authorized_request(
        reqwest::Client::new().post(format!("{api_url}/feedback/events")),
    )
        .header("x-immobilia-user-id", user_id)
        .json(&json!({ "events": events }))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    let _body: Value = response.json().await.map_err(|error| error.to_string())?;
    mark_rows_synced(pool, "feedback_events", &ids).await?;
    Ok(ids.len())
}

async fn sync_pending_agent_runs(pool: &SqlitePool) -> Result<usize, String> {
    let Some(api_url) = admin_api_url() else {
        return Ok(0);
    };
    let user_id = sync_user_id(pool).await?;
    let user = load_user(pool).await?;
    let rows = sqlx::query(
        r#"
        SELECT
            agent_runs.id,
            agent_runs.radar_id,
            radars_ws.name AS radar_name,
            agent_runs.started_at,
            agent_runs.finished_at,
            agent_runs.status,
            agent_runs.publications_count,
            agent_runs.leads_count,
            agent_runs.matches_count,
            agent_runs.response_payload
        FROM agent_runs
        LEFT JOIN radars_ws ON radars_ws.id = agent_runs.radar_id
        WHERE agent_runs.synced_at IS NULL
          AND agent_runs.finished_at IS NOT NULL
        ORDER BY agent_runs.started_at
        LIMIT 20
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    let mut synced_ids = Vec::new();
    for row in rows {
        let id: String = row.get("id");
        let payload: Option<String> = row.get("response_payload");
        authorized_request(
            reqwest::Client::new().post(format!("{api_url}/agent-runs/completed")),
        )
            .header("x-immobilia-user-id", &user_id)
            .json(&json!({
                "runId": id,
                "radarId": row.get::<String, _>("radar_id"),
                "radarName": row.get::<Option<String>, _>("radar_name"),
                "status": row.get::<String, _>("status"),
                "publicationsCount": row.get::<i64, _>("publications_count"),
                "leadsCount": row.get::<i64, _>("leads_count"),
                "matchesCount": row.get::<i64, _>("matches_count"),
                "startedAt": row.get::<String, _>("started_at"),
                "finishedAt": row.get::<Option<String>, _>("finished_at"),
                "recipientEmail": user.as_ref().map(|user| user.email.clone()),
                "recipientName": user.as_ref().map(|user| user.name.clone()),
                "notifyOnCompletion": true,
                "payload": payload
                    .as_deref()
                    .and_then(|payload| serde_json::from_str::<Value>(payload).ok())
                    .unwrap_or_else(|| json!({}))
            }))
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?;
        synced_ids.push(id);
    }

    mark_rows_synced(pool, "agent_runs", &synced_ids).await?;
    Ok(synced_ids.len())
}

async fn mark_rows_synced(pool: &SqlitePool, table: &str, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }

    for id in ids {
        let query = format!("UPDATE {table} SET synced_at = datetime('now') WHERE id = ?1");
        sqlx::query(&query)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

async fn sync_user_id(pool: &SqlitePool) -> Result<String, String> {
    if let Ok(user_id) = std::env::var("IMMOBILIA_USER_ID") {
        if !user_id.trim().is_empty() {
            return Ok(user_id.trim().to_string());
        }
    }

    if let Some(user) = load_user(pool).await? {
        return Ok(user.id);
    }

    Ok("local-dev-user".to_string())
}

async fn count_matches(pool: &SqlitePool) -> Result<i64, String> {
    let row = sqlx::query("SELECT count(*) AS count FROM matches WHERE status != 'Rechazado'")
        .fetch_one(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(row.get("count"))
}

fn admin_api_url() -> Option<String> {
    std::env::var("IMMOBILIA_ADMIN_API_URL")
        .ok()
        .map(|url| url.trim().trim_end_matches('/').to_string())
        .filter(|url| !url.is_empty())
}

async fn request_proxy_token(user_id: &str, radar: &Radar) -> Result<Option<Value>, String> {
    let Some(api_url) = admin_api_url() else {
        return Ok(None);
    };

    let response = authorized_request(reqwest::Client::new().post(format!("{api_url}/proxy/token")))
        .header("x-immobilia-user-id", user_id)
        .json(&json!({
            "radarId": radar.id,
            "radarName": radar.name,
            "country": radar.country,
            "zone": radar.zone,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;

    Ok(response.get("proxy").cloned().filter(|proxy| {
        proxy
            .get("server")
            .and_then(Value::as_str)
            .map(|server| !server.trim().is_empty())
            .unwrap_or(false)
    }))
}

fn authorized_request(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    if let Ok(token) = std::env::var("IMMOBILIA_LICENSE_TOKEN") {
        if !token.trim().is_empty() {
            return request.bearer_auth(token.trim().to_string());
        }
    }
    request
}

fn normalize_publication_payload(input: Value, default_zone: Option<&str>) -> Value {
    let mut object = input.as_object().cloned().unwrap_or_default();
    let id = string_field(&input, &["id"]).unwrap_or_else(|| format!("pub-{}", Uuid::new_v4()));
    let title = string_field(&input, &["title", "headline"])
        .or_else(|| string_field(&input, &["rawText", "raw_text"]))
        .unwrap_or_else(|| "Publicacion sin titulo".to_string());
    let source = normalize_property_source(string_field(&input, &["source"]));
    let location = string_field(&input, &["location", "zone"]).unwrap_or_else(|| {
        default_zone
            .map(str::to_string)
            .unwrap_or_else(|| "Sin zona".to_string())
    });
    let image_url = first_image(&input).unwrap_or_else(default_property_image);

    object.insert("id".to_string(), Value::String(id));
    object.insert("title".to_string(), Value::String(title));
    object.insert("source".to_string(), Value::String(source));
    object.insert("location".to_string(), Value::String(location));
    object.insert(
        "price".to_string(),
        Value::Number(i64_field(&input, &["price"]).unwrap_or(0).into()),
    );
    object.insert(
        "areaM2".to_string(),
        json!(f64_field(&input, &["areaM2", "area", "area_m2"]).unwrap_or(0.0)),
    );
    object.insert(
        "rooms".to_string(),
        Value::Number(
            i64_field(&input, &["rooms", "bedrooms"])
                .unwrap_or(0)
                .into(),
        ),
    );
    object.insert(
        "lat".to_string(),
        json!(f64_field(&input, &["lat"]).unwrap_or(0.0)),
    );
    object.insert(
        "lng".to_string(),
        json!(f64_field(&input, &["lng", "lon"]).unwrap_or(0.0)),
    );
    object.insert("imageUrl".to_string(), Value::String(image_url));

    copy_if_present(
        &mut object,
        &input,
        "ownerName",
        &["ownerName", "owner_name"],
    );
    copy_if_present(
        &mut object,
        &input,
        "ownerPhone",
        &["ownerPhone", "owner_phone", "phone"],
    );
    copy_if_present(
        &mut object,
        &input,
        "ownerEmail",
        &["ownerEmail", "owner_email", "email"],
    );
    copy_if_present(
        &mut object,
        &input,
        "url",
        &["url", "sourceUrl", "source_url"],
    );
    copy_if_present(&mut object, &input, "rawText", &["rawText", "raw_text"]);

    Value::Object(object)
}

fn normalize_lead_payload(input: Value, default_zone: Option<&str>) -> Value {
    let mut object = input.as_object().cloned().unwrap_or_default();
    let id = string_field(&input, &["id"]).unwrap_or_else(|| format!("lead-{}", Uuid::new_v4()));
    let name = string_field(&input, &["name"]).unwrap_or_else(|| "Lead detectado".to_string());
    let looking_for = string_field(&input, &["lookingFor", "looking_for"])
        .or_else(|| string_field(&input, &["rawText", "raw_text"]))
        .unwrap_or_else(|| "Busqueda inmobiliaria".to_string());
    let location = string_field(&input, &["location", "zone"]).unwrap_or_else(|| {
        default_zone
            .map(str::to_string)
            .unwrap_or_else(|| "Sin zona".to_string())
    });

    object.insert("id".to_string(), Value::String(id));
    object.insert("name".to_string(), Value::String(name));
    object.insert("lookingFor".to_string(), Value::String(looking_for));
    object.insert(
        "budget".to_string(),
        Value::Number(i64_field(&input, &["budget", "price"]).unwrap_or(0).into()),
    );
    object.insert("location".to_string(), Value::String(location));

    if let Some(role) = normalize_lead_role(string_field(&input, &["role"])) {
        object.insert("role".to_string(), Value::String(role));
    }
    copy_if_present(
        &mut object,
        &input,
        "phone",
        &["phone", "ownerPhone", "owner_phone"],
    );
    copy_if_present(
        &mut object,
        &input,
        "email",
        &["email", "ownerEmail", "owner_email"],
    );
    copy_if_present(&mut object, &input, "address", &["address"]);
    copy_if_present(
        &mut object,
        &input,
        "propertyId",
        &["propertyId", "property_id"],
    );
    copy_if_present(
        &mut object,
        &input,
        "propertySummary",
        &["propertySummary", "property_summary"],
    );
    copy_if_present(
        &mut object,
        &input,
        "sourceUrl",
        &["sourceUrl", "source_url", "url"],
    );
    copy_if_present(&mut object, &input, "rawText", &["rawText", "raw_text"]);

    Value::Object(object)
}

fn copy_if_present(
    object: &mut serde_json::Map<String, Value>,
    input: &Value,
    target: &str,
    keys: &[&str],
) {
    if let Some(value) = string_field(input, keys) {
        object.insert(target.to_string(), Value::String(value));
    }
}

fn infer_document_kind(document: &Value) -> &'static str {
    if document.get("lookingFor").is_some()
        || document.get("looking_for").is_some()
        || document.get("budget").is_some() && document.get("name").is_some()
    {
        "lead"
    } else {
        "property"
    }
}

fn normalize_property_source(source: Option<String>) -> String {
    let normalized = source
        .unwrap_or_else(|| "Scraper".to_string())
        .to_lowercase();
    if normalized.contains("manual") {
        "Manual".to_string()
    } else if normalized.contains("red")
        || normalized.contains("social")
        || normalized.contains("foro")
    {
        "Red social".to_string()
    } else if normalized.contains("portal") {
        "Portal".to_string()
    } else {
        "Scraper".to_string()
    }
}

fn normalize_lead_role(role: Option<String>) -> Option<String> {
    let role = role?;
    match role.as_str() {
        "Propietario" | "Arrendador" | "Comprador" | "Arrendatario" => Some(role),
        _ => None,
    }
}

fn first_image(value: &Value) -> Option<String> {
    string_field(value, &["imageUrl", "image_url"]).or_else(|| {
        value
            .get("images")
            .and_then(Value::as_array)
            .and_then(|images| images.first())
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            if !text.trim().is_empty() {
                return Some(text.trim().to_string());
            }
        }
    }
    None
}

fn i64_field(value: &Value, keys: &[&str]) -> Option<i64> {
    for key in keys {
        if let Some(number) = value.get(*key).and_then(Value::as_i64) {
            return Some(number);
        }
        if let Some(number) = value.get(*key).and_then(Value::as_f64) {
            return Some(number.round() as i64);
        }
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            let cleaned = text
                .chars()
                .filter(|character| character.is_ascii_digit())
                .collect::<String>();
            if let Ok(number) = cleaned.parse::<i64>() {
                return Some(number);
            }
        }
    }
    None
}

fn f64_field(value: &Value, keys: &[&str]) -> Option<f64> {
    for key in keys {
        if let Some(number) = value.get(*key).and_then(Value::as_f64) {
            return Some(number);
        }
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            let cleaned = text.replace(',', ".");
            if let Ok(number) = cleaned.parse::<f64>() {
                return Some(number);
            }
        }
    }
    None
}

fn default_property_image() -> String {
    "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=900&q=80"
        .to_string()
}

fn scraper_agent_url() -> String {
    std::env::var("IMMOBILIA_SCRAPER_AGENT_URL")
        .unwrap_or_else(|_| "http://localhost:8787".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn configured_nlp_provider() -> String {
    std::env::var("IMMOBILIA_NLP_PROVIDER").unwrap_or_else(|_| "none".to_string())
}

#[allow(dead_code)]
struct DemoEntities {
    properties: Vec<Value>,
    leads: Vec<Value>,
    matches: Vec<Value>,
}

#[allow(dead_code)]
fn demo_entities() -> DemoEntities {
    let property_a = json!({
        "id": "prop-101",
        "title": "Apartamento exterior 2 habitaciones",
        "source": "Scraper",
        "location": "Bogota - Chapinero",
        "price": 420000000,
        "areaM2": 72,
        "rooms": 2,
        "lat": 4.649,
        "lng": -74.063,
        "imageUrl": "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=900&q=80",
        "ownerName": "Carlos Marin",
        "ownerPhone": "+573104455667",
        "ownerEmail": "carlos.marin@example.com",
        "url": "https://example.com/publicacion/prop-101"
    });
    let property_b = json!({
        "id": "prop-103",
        "title": "Apartamento publicado por agencia aliada",
        "source": "Portal",
        "location": "Bogota - Chapinero",
        "price": 418000000,
        "areaM2": 71,
        "rooms": 2,
        "lat": 4.650,
        "lng": -74.061,
        "imageUrl": "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=80",
        "ownerName": "Carlos Marin",
        "ownerPhone": "+573104455667",
        "ownerEmail": "carlos.marin@example.com",
        "url": "https://example.com/publicacion/prop-103"
    });
    let property_c = json!({
        "id": "prop-102",
        "title": "Casa familiar con patio",
        "source": "Manual",
        "location": "Antioquia - Envigado",
        "price": 690000000,
        "areaM2": 138,
        "rooms": 4,
        "lat": 6.171,
        "lng": -75.583,
        "imageUrl": "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=900&q=80",
        "ownerName": "Marta Salazar",
        "ownerPhone": "+573005557788",
        "ownerEmail": "marta.salazar@example.com",
        "url": "https://example.com/publicacion/prop-102"
    });
    let property_d = json!({
        "id": "prop-104",
        "title": "Casa duplicada en clasificados locales",
        "source": "Red social",
        "location": "Antioquia - Envigado",
        "price": 705000000,
        "areaM2": 140,
        "rooms": 4,
        "lat": 6.172,
        "lng": -75.582,
        "imageUrl": "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=900&q=80",
        "ownerName": "Marta Salazar",
        "ownerPhone": "+573005557788",
        "ownerEmail": "marta.salazar@example.com",
        "url": "https://example.com/publicacion/prop-104"
    });
    let property_e = json!({
        "id": "prop-105",
        "title": "Apartamento tipo loft cerca a parque",
        "source": "Scraper",
        "location": "Bogota - Usaquen",
        "price": 360000000,
        "areaM2": 55,
        "rooms": 1,
        "lat": 4.704,
        "lng": -74.032,
        "imageUrl": "https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=900&q=80",
        "ownerName": "Laura Cardenas",
        "ownerPhone": "+573156661212",
        "ownerEmail": "laura.cardenas@example.com",
        "url": "https://example.com/publicacion/prop-105"
    });
    let property_f = json!({
        "id": "prop-106",
        "title": "Loft republicado con fotos similares",
        "source": "Portal",
        "location": "Bogota - Usaquen",
        "price": 355000000,
        "areaM2": 56,
        "rooms": 1,
        "lat": 4.705,
        "lng": -74.031,
        "imageUrl": "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=900&q=80",
        "ownerName": "Laura Cardenas",
        "ownerPhone": "+573156661212",
        "ownerEmail": "laura.cardenas@example.com",
        "url": "https://example.com/publicacion/prop-106"
    });
    let lead_a = json!({
        "id": "lead-201",
        "name": "Andres Gomez",
        "role": "Comprador",
        "phone": "+573222224444",
        "email": "andres.gomez@example.com",
        "address": "Chapinero Alto, Bogota",
        "lookingFor": "Apartamento de 2 habitaciones para compra",
        "budget": 450000000,
        "location": "Bogota - Chapinero",
        "propertySummary": "Apto 2 hab, 60-80 m2, parqueadero, cerca a zona financiera",
        "sourceUrl": "https://facebook.com/groups/inmuebles/posts/201"
    });
    let lead_b = json!({
        "id": "lead-202",
        "name": "Paula Restrepo",
        "role": "Propietario",
        "phone": "+573188889999",
        "email": "paula.restrepo@example.com",
        "address": "Loma del Escobero, Envigado",
        "lookingFor": "Vende casa familiar con patio",
        "budget": 690000000,
        "location": "Antioquia - Envigado",
        "propertyId": "prop-102",
        "sourceUrl": "https://example.com/foro/lead-202"
    });
    let lead_c = json!({
        "id": "lead-203",
        "name": "Nicolas Bernal",
        "role": "Arrendatario",
        "phone": "+573145551919",
        "email": "nicolas.bernal@example.com",
        "address": "Usaquen, Bogota",
        "lookingFor": "Apartamento de inversion para alquiler",
        "budget": 380000000,
        "location": "Bogota - Usaquen",
        "propertySummary": "Loft o apto 1 hab, 45-60 m2, cocina abierta, balcon o zona coworking",
        "sourceUrl": "https://example.com/grupo/lead-203"
    });
    let lead_d = json!({
        "id": "lead-204",
        "name": "Laura Cardenas",
        "role": "Arrendador",
        "phone": "+573156661212",
        "email": "laura.cardenas@example.com",
        "address": "Cedritos, Bogota",
        "lookingFor": "Arrienda apartamento tipo loft cerca a parque",
        "budget": 2600000,
        "location": "Bogota - Usaquen",
        "propertyId": "prop-105",
        "sourceUrl": "https://example.com/grupo/lead-204"
    });
    let match_a = json!({
        "id": "match-301",
        "property": property_a.clone(),
        "comparisonProperty": property_b.clone(),
        "lead": lead_a.clone(),
        "similarity": {
            "gps": 91,
            "visual": 84,
            "features": 89,
            "confidence": weighted_confidence(91.0, 84.0, 89.0)
        },
        "status": "Pendiente"
    });
    let match_b = json!({
        "id": "match-302",
        "property": property_c.clone(),
        "comparisonProperty": property_d.clone(),
        "lead": lead_b.clone(),
        "similarity": {
            "gps": 86,
            "visual": 78,
            "features": 93,
            "confidence": weighted_confidence(86.0, 78.0, 93.0)
        },
        "status": "Pendiente"
    });
    let match_c = json!({
        "id": "match-303",
        "property": property_e.clone(),
        "comparisonProperty": property_f.clone(),
        "lead": lead_c.clone(),
        "similarity": {
            "gps": 88,
            "visual": 81,
            "features": 86,
            "confidence": weighted_confidence(88.0, 81.0, 86.0)
        },
        "status": "Pendiente"
    });

    DemoEntities {
        properties: vec![
            property_a, property_b, property_c, property_d, property_e, property_f,
        ],
        leads: vec![lead_a, lead_b, lead_c, lead_d],
        matches: vec![match_a, match_b, match_c],
    }
}

#[allow(dead_code)]
fn weighted_confidence(gps: f32, visual: f32, features: f32) -> f32 {
    (gps * 0.30) + (visual * 0.40) + (features * 0.30)
}

fn main() {
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            let db_path = app_dir.join("immobil-ia.sqlite");
            let pool = tauri::async_runtime::block_on(init_database(db_path)).map_err(|error| {
                Box::<dyn std::error::Error>::from(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    error,
                ))
            })?;
            app.manage(AppState {
                db: Mutex::new(pool),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            save_user,
            save_radar,
            create_manual_entity,
            update_match_status,
            record_feedback,
            open_external_url,
            save_template,
            run_radar
        ])
        .run(tauri::generate_context!())
        .expect("error while running Immobil-IA");
}
