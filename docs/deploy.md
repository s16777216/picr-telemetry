# 部署

在一台跟 GitLab 同一個內網的 Linux VM 上執行 picr-telemetry。下面的指令以 Ubuntu 為例。

## 1. 安裝 Node 24

```bash
node --version   # 需要 v24 或以上
```

`better-sqlite3` 在 Linux x64 有預先編譯好的檔案，一般不需要編譯工具。若安裝時要求編譯，請先安裝 `build-essential` 和 `python3`。

## 2. 建立帳號和資料夾

```bash
sudo useradd --system --home /opt/picr-telemetry --shell /usr/sbin/nologin picr
sudo mkdir -p /opt/picr-telemetry /var/lib/picr-telemetry
sudo chown picr:picr /var/lib/picr-telemetry
```

## 3. 安裝和建置

把這個 repository 放到 `/opt/picr-telemetry`，然後：

```bash
cd /opt/picr-telemetry
npm ci
npm run build          # 產生 dist/server 和 dist/web
npm prune --omit=dev   # 建置完成後移除開發用的套件
sudo chown -R picr:picr /opt/picr-telemetry
```

## 4. 設定

服務只讀環境變數，沒有設定檔：

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 兩個 port 監聽的位址 |
| `INGEST_PORT` | `4318` | 接收 trace 的 port（`POST /v1/traces`） |
| `UI_PORT` | `8080` | Web UI、讀取 API 和 `/healthz` 的 port |
| `DATABASE_PATH` | `./data/picr-telemetry.sqlite` | SQLite 檔案的位置，資料夾不存在時會自動建立 |
| `RETENTION_DAYS` | `90` | 保留幾天；超過的 run 每天刪除一次 |

值不合法時（例如 `RETENTION_DAYS=abc`），服務會印出原因並停止。

## 5. 用 systemd 執行

```bash
sudo cp deploy/picr-telemetry.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now picr-telemetry
systemctl status picr-telemetry
curl http://127.0.0.1:8080/healthz   # {"status":"ok"}
```

要改設定時，編輯 unit 檔裡的 `Environment=` 行，再執行 `sudo systemctl restart picr-telemetry`。

## 6. 防火牆

trace 裡有被審查的程式碼和 prompt，而 UI 沒有登入、接收端也不驗證。請只開給需要的網段：

- `4318`：只開給 GitLab runner。
- `8080`：只開給團隊的網段。

```bash
sudo ufw allow from <GitLab runner 的網段> to any port 4318 proto tcp
sudo ufw allow from <團隊的網段> to any port 8080 proto tcp
```

## 7. 讓 pi-code-review 送資料過來

在 GitLab 的 **instance 或 group** 層級設定 CI/CD 變數（Settings → CI/CD → Variables）：

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://<這台 VM 的位址>:4318
```

所有專案的 pipeline 都會帶到這個變數，不用每個專案各自設定。不要把位址寫進專案的檔案。設定完成後，下一次 review 就會出現在 `http://<這台 VM 的位址>:8080/`。

## 8. 上線一週後

- 檢查資料庫大小，再決定保留天數：

  ```bash
  du -h /var/lib/picr-telemetry/
  ```

- 備份（建議每天一次）。服務執行中也可以安全備份：

  ```bash
  sqlite3 /var/lib/picr-telemetry/picr-telemetry.sqlite ".backup '/backup/picr-telemetry-$(date +%F).sqlite'"
  ```

## 更新版本

```bash
cd /opt/picr-telemetry
git pull
npm ci && npm run build && npm prune --omit=dev
sudo systemctl restart picr-telemetry
```

資料庫的 schema 會在服務啟動時自動升級。
