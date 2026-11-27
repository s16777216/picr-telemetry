# picr-telemetry

接收 [pi-code-review](https://github.com/s16777216/pi-code-review)（`picr`）送出的 OpenTelemetry trace，存進 SQLite，並提供給團隊看的 web UI。目前只處理 `review` 的 trace。

設計：[docs/design.md](docs/design.md)

## 讓 CLI 送資料到這裡

在 GitLab 的 instance 或 group 層級設定 CI/CD 變數：

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://<這台 VM 的位址>:4318
```

每個專案的 pipeline 都會帶到這個變數，不需要各自設定。不要把位址寫進專案的檔案。
