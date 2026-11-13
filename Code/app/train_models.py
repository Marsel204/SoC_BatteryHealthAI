"""Train all five models and write their fitted artifacts to <project>/Model/."""
from server import paths
from server.model_store import MODEL_FILES, load_or_train_models


def main() -> None:
    load_or_train_models(retrain=True)
    for name, filename in MODEL_FILES.items():
        print(f"{name}: {paths.MODEL_DIR / filename}")
    print(f"Metadata: {paths.MODEL_DIR / 'manifest.json'}")


if __name__ == "__main__":
    main()
