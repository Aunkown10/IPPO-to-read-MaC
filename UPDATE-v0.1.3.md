# Ippo to Read v0.1.3

## Completed-reading behavior

- A comic/chapter is considered completed when its saved bookmark reaches 100%.
- Completed chapters are automatically removed from **Continue reading**.
- Shelf resume now skips completed chapters and continues from the newest unfinished chapter instead.
- Completed chapter rows are dimmed and carry a **Completed** badge/status.
- When every comic in a shelf is complete, the shelf card is dimmed and shows **Completed** at the bottom.
- A fully completed shelf offers **Read again** instead of **Continue reading**.

No database migration is required. Completion is derived from the bookmark data already stored by Ippo to Read.
