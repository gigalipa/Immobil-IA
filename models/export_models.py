from __future__ import annotations

from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


ROOT = Path(__file__).resolve().parent
OPSET = 13
IR_VERSION = 7


def tensor(name: str, values: np.ndarray) -> onnx.TensorProto:
    return numpy_helper.from_array(values.astype(np.float32), name=name)


def make_linear_score_model(
    *,
    model_name: str,
    input_size: int,
    component_weights: np.ndarray,
    component_bias: np.ndarray,
    confidence_weights: np.ndarray,
    output_path: Path,
    doc_string: str,
) -> None:
    input_info = helper.make_tensor_value_info(
        "input",
        TensorProto.FLOAT,
        [1, input_size],
    )
    output_info = helper.make_tensor_value_info(
        "scores",
        TensorProto.FLOAT,
        [1, 4],
    )

    min_value = np.array([0.0], dtype=np.float32)
    max_value = np.array([100.0], dtype=np.float32)

    initializers = [
        tensor("component_weights", component_weights),
        tensor("component_bias", component_bias.reshape(1, 3)),
        tensor("confidence_weights", confidence_weights.reshape(3, 1)),
        tensor("confidence_bias", np.zeros((1, 1), dtype=np.float32)),
        tensor("clip_min", min_value),
        tensor("clip_max", max_value),
    ]

    nodes = [
        helper.make_node(
            "MatMul",
            ["input", "component_weights"],
            ["raw_components"],
            name="component_matmul",
        ),
        helper.make_node(
            "Add",
            ["raw_components", "component_bias"],
            ["biased_components"],
            name="component_bias_add",
        ),
        helper.make_node(
            "Clip",
            ["biased_components", "clip_min", "clip_max"],
            ["components"],
            name="component_clip_0_100",
        ),
        helper.make_node(
            "MatMul",
            ["components", "confidence_weights"],
            ["raw_confidence"],
            name="confidence_matmul",
        ),
        helper.make_node(
            "Add",
            ["raw_confidence", "confidence_bias"],
            ["biased_confidence"],
            name="confidence_bias_add",
        ),
        helper.make_node(
            "Clip",
            ["biased_confidence", "clip_min", "clip_max"],
            ["confidence"],
            name="confidence_clip_0_100",
        ),
        helper.make_node(
            "Concat",
            ["components", "confidence"],
            ["scores"],
            name="scores_concat",
            axis=1,
        ),
    ]

    graph = helper.make_graph(
        nodes,
        model_name,
        [input_info],
        [output_info],
        initializer=initializers,
    )
    model = helper.make_model(
        graph,
        producer_name="immobil-ia",
        producer_version="0.1.0",
        opset_imports=[helper.make_opsetid("", OPSET)],
        doc_string=doc_string,
    )
    model.ir_version = IR_VERSION
    model.metadata_props.add(key="input_name", value="input")
    model.metadata_props.add(key="output_name", value="scores")
    model.metadata_props.add(key="score_order", value="gps,visual,features,confidence")
    model.metadata_props.add(key="input_scale", value="all features normalized to 0..1")
    model.metadata_props.add(key="output_scale", value="scores clipped to 0..100")

    onnx.checker.check_model(model)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, output_path)


def export_post_comparer() -> None:
    weights = np.zeros((12, 3), dtype=np.float32)
    bias = np.zeros(3, dtype=np.float32)

    # gps = 100 - 100 * distanceKmNormalized
    weights[0, 0] = -100.0
    bias[0] = 100.0

    # visual = owner/contact/image/source evidence, with the same 45-point
    # unknown-data baseline used by the Rust placeholder.
    weights[7, 1] = 43.0
    weights[8, 1] = 12.0
    weights[9, 1] = 17.0
    weights[10, 1] = 4.0
    weights[11, 1] = 4.0
    bias[1] = 45.0

    # features = weighted property-attribute similarity.
    weights[1, 2] = 20.0
    weights[2, 2] = 20.0
    weights[3, 2] = 18.0
    weights[4, 2] = 16.0
    weights[5, 2] = 18.0
    weights[6, 2] = 8.0

    make_linear_score_model(
        model_name="post_comparer_baseline",
        input_size=12,
        component_weights=weights,
        component_bias=bias,
        confidence_weights=np.array([0.30, 0.40, 0.30], dtype=np.float32),
        output_path=ROOT / "post_comparer.onnx",
        doc_string="Baseline PostComparer model for duplicate property publication scoring.",
    )


def export_matchmaker() -> None:
    weights = np.zeros((14, 3), dtype=np.float32)
    bias = np.zeros(3, dtype=np.float32)

    # gps/location affinity.
    weights[0, 0] = 100.0

    # visual is currently a quality/contact/intent signal until visual
    # embeddings are introduced.
    weights[2, 1] = 30.0
    weights[6, 1] = 15.0
    weights[7, 1] = 10.0
    weights[8, 1] = 15.0
    weights[9, 1] = 10.0
    weights[10, 1] = 10.0
    weights[11, 1] = 10.0

    # features emphasizes match preference fit for fewer false positives.
    weights[1, 2] = 30.0
    weights[3, 2] = 25.0
    weights[4, 2] = 20.0
    weights[5, 2] = 15.0
    weights[10, 2] = 5.0
    weights[11, 2] = 5.0
    weights[12, 2] = -2.5
    weights[13, 2] = 2.5
    bias[2] = 2.5

    make_linear_score_model(
        model_name="matchmaker_baseline",
        input_size=14,
        component_weights=weights,
        component_bias=bias,
        confidence_weights=np.array([0.30, 0.25, 0.45], dtype=np.float32),
        output_path=ROOT / "matchmaker.onnx",
        doc_string="Baseline MatchMaker model for lead-property suggestion scoring.",
    )


def main() -> None:
    export_post_comparer()
    export_matchmaker()
    print(f"Exported {ROOT / 'post_comparer.onnx'}")
    print(f"Exported {ROOT / 'matchmaker.onnx'}")


if __name__ == "__main__":
    main()
