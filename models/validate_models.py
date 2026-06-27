from __future__ import annotations

from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort


ROOT = Path(__file__).resolve().parent


def expected_post_comparer(x: np.ndarray) -> np.ndarray:
    gps = np.clip(100.0 - 100.0 * x[:, 0], 0.0, 100.0)
    visual = np.clip(
        45.0
        + 43.0 * x[:, 7]
        + 12.0 * x[:, 8]
        + 17.0 * x[:, 9]
        + 4.0 * x[:, 10]
        + 4.0 * x[:, 11],
        0.0,
        100.0,
    )
    features = np.clip(
        20.0 * x[:, 1]
        + 20.0 * x[:, 2]
        + 18.0 * x[:, 3]
        + 16.0 * x[:, 4]
        + 18.0 * x[:, 5]
        + 8.0 * x[:, 6],
        0.0,
        100.0,
    )
    confidence = np.clip(0.30 * gps + 0.40 * visual + 0.30 * features, 0.0, 100.0)
    return np.stack([gps, visual, features, confidence], axis=1).astype(np.float32)


def expected_matchmaker(x: np.ndarray) -> np.ndarray:
    gps = np.clip(100.0 * x[:, 0], 0.0, 100.0)
    visual = np.clip(
        30.0 * x[:, 2]
        + 15.0 * x[:, 6]
        + 10.0 * x[:, 7]
        + 15.0 * x[:, 8]
        + 10.0 * x[:, 9]
        + 10.0 * x[:, 10]
        + 10.0 * x[:, 11],
        0.0,
        100.0,
    )
    features = np.clip(
        2.5
        + 30.0 * x[:, 1]
        + 25.0 * x[:, 3]
        + 20.0 * x[:, 4]
        + 15.0 * x[:, 5]
        + 5.0 * x[:, 10]
        + 5.0 * x[:, 11]
        - 2.5 * x[:, 12]
        + 2.5 * x[:, 13],
        0.0,
        100.0,
    )
    confidence = np.clip(0.30 * gps + 0.25 * visual + 0.45 * features, 0.0, 100.0)
    return np.stack([gps, visual, features, confidence], axis=1).astype(np.float32)


def validate_model(
    model_path: Path,
    input_size: int,
    expected_fn,
) -> None:
    model = onnx.load(model_path)
    onnx.checker.check_model(model)

    graph = model.graph
    input_name = graph.input[0].name
    output_name = graph.output[0].name
    if input_name != "input":
        raise AssertionError(f"{model_path.name}: expected input name 'input', got {input_name!r}")
    if output_name != "scores":
        raise AssertionError(f"{model_path.name}: expected output name 'scores', got {output_name!r}")

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    sample = np.linspace(0.0, 1.0, input_size, dtype=np.float32).reshape(1, input_size)
    scores = session.run(["scores"], {"input": sample})[0]
    expected = expected_fn(sample)

    if scores.shape != (1, 4):
        raise AssertionError(f"{model_path.name}: expected output shape (1, 4), got {scores.shape}")
    if np.any(scores < -1e-5) or np.any(scores > 100.00001):
        raise AssertionError(f"{model_path.name}: scores out of 0..100 range: {scores}")
    np.testing.assert_allclose(scores, expected, rtol=1e-6, atol=1e-5)
    print(f"{model_path.name}: OK {scores.round(4).tolist()}")


def main() -> None:
    validate_model(ROOT / "post_comparer.onnx", 12, expected_post_comparer)
    validate_model(ROOT / "matchmaker.onnx", 14, expected_matchmaker)


if __name__ == "__main__":
    main()
