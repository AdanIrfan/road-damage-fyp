# Dataset and Model Notes

This file records only **confirmed** information about the dataset and the trained model.
Do not add split sizes, class counts, or accuracy figures here unless they have been measured and checked.

## Confirmed information

- **Dataset:** The project uses the **RDD2022** road damage dataset.
- **Model:** A **YOLOv8** model has been trained.
- **Weights file:** The trained weights file is named **`best.pt`**.
- **Repository status:** The weights have **not yet** been copied into this repository.
  - Intended location once added: `backend/ai/weights/best.pt` (the weights folder of the AI service, in the approved backend structure).
  - Weights are excluded from Git by `.gitignore`. How they will be stored and shared (for example Git LFS, cloud storage, or a manual download step) has not been decided yet.
- **Evaluation:** Model evaluation and performance improvement are planned for a **later stage**.

## Not yet documented

The following have not been recorded yet. Fill them in only from verified sources:

- Dataset subset or countries used from RDD2022
- Train / validation / test split details
- Damage class names and label mapping used during training
- Training configuration (model size, epochs, image size, hyperparameters)
- Evaluation metrics (for example mAP, precision, recall)
- Dataset licence and citation
