import type { MatchSuggestion, Property, PropertyGroup, PropertyRelation } from "./types";

type DisjointSet = {
  find: (id: string) => string;
  union: (a: string, b: string) => void;
};

export function buildPropertyGroups(
  properties: Property[],
  matches: MatchSuggestion[],
  manualRelations: PropertyRelation[]
): PropertyGroup[] {
  const publicationMap = new Map(properties.map((property) => [property.id, property]));
  const disjointSet = createDisjointSet(properties.map((property) => property.id));
  const relationByPair = new Map<string, PropertyRelation>();

  for (const match of matches) {
    const comparison = match.comparisonProperty;
    if (!comparison || match.status === "Rechazado") continue;
    ensureProperty(publicationMap, match.property);
    ensureProperty(publicationMap, comparison);
    disjointSet.union(match.property.id, comparison.id);
    relationByPair.set(pairKey(match.property.id, comparison.id), {
      propertyIds: [match.property.id, comparison.id],
      certainty: match.status === "Confirmado" ? 100 : match.similarity.confidence,
      source: "ml",
      status: match.status === "Confirmado" ? "Confirmado" : "Pendiente",
    });
  }

  for (const relation of manualRelations) {
    const [first, ...rest] = relation.propertyIds;
    if (!first) continue;
    for (const propertyId of rest) {
      disjointSet.union(first, propertyId);
      relationByPair.set(pairKey(first, propertyId), relation);
    }
  }

  const buckets = new Map<string, Property[]>();
  for (const property of publicationMap.values()) {
    const root = disjointSet.find(property.id);
    buckets.set(root, [...(buckets.get(root) || []), property]);
  }

  return [...buckets.entries()]
    .map(([root, publications]) => {
      const relations = collectRelations(publications, relationByPair);
      const hasHuman = relations.some((relation) => relation.source === "human");
      const hasConfirmed = relations.some((relation) => relation.status === "Confirmado");
      const hasMl = relations.some((relation) => relation.source === "ml");
      const representative = chooseRepresentative(publications);
      const certainty = relations.length
        ? hasHuman || hasConfirmed
          ? 100
          : Math.round(
              relations.reduce((sum, relation) => sum + relation.certainty, 0) / relations.length
            )
        : undefined;

      return {
        id: root,
        title: representative.title,
        location: representative.location,
        representative,
        publications,
        certainty,
        source: hasHuman ? "Humano" : hasMl ? "ML" : "Sin comparar",
        status: certainty === 100 ? "Confirmado" : relations.length ? "Pendiente HITL" : "Sin comparar",
      } satisfies PropertyGroup;
    })
    .sort((a, b) => b.publications.length - a.publications.length || a.title.localeCompare(b.title));
}

export function relatePropertyGroups(first: PropertyGroup, second: PropertyGroup): PropertyRelation {
  return {
    propertyIds: [first.representative.id, second.representative.id],
    certainty: 100,
    source: "human",
    status: "Confirmado",
  };
}

function createDisjointSet(ids: string[]): DisjointSet {
  const parent = new Map(ids.map((id) => [id, id]));

  const find = (id: string): string => {
    if (!parent.has(id)) {
      parent.set(id, id);
    }
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  return { find, union };
}

function ensureProperty(map: Map<string, Property>, property: Property) {
  if (!map.has(property.id)) {
    map.set(property.id, property);
  }
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join("::");
}

function collectRelations(publications: Property[], relationByPair: Map<string, PropertyRelation>) {
  const relations: PropertyRelation[] = [];
  for (let index = 0; index < publications.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < publications.length; otherIndex += 1) {
      const relation = relationByPair.get(pairKey(publications[index].id, publications[otherIndex].id));
      if (relation) relations.push(relation);
    }
  }
  return relations;
}

function chooseRepresentative(publications: Property[]) {
  return [...publications].sort((a, b) => {
    const sourceScore = scoreSource(b.source) - scoreSource(a.source);
    if (sourceScore !== 0) return sourceScore;
    return b.areaM2 - a.areaM2;
  })[0];
}

function scoreSource(source: Property["source"]) {
  if (source === "Manual") return 3;
  if (source === "Scraper") return 2;
  return 1;
}
