
Nah, kalau maunya **self-hosted**, arsitekturnya justru bisa lebih enak: **GitHub hanya mengirim webhook**, sedangkan proses review sepenuhnya jalan di VPS/server kamu.

```text
             GitHub
               │
        PR opened / updated
               │
               ▼
      https://review.domain.com
               │
        ┌──────▼───────┐
        │ Webhook API  │
        │ self-hosted  │
        └──────┬───────┘
               │
          masuk queue
               │
        ┌──────▼───────┐
        │ Review Worker│
        └──────┬───────┘
               │
        clone / git fetch
               │
               ▼
        ┌──────────────┐
        │   OpenCode   │
        │ self-hosted  │
        └──────┬───────┘
               │
          hasil review
               │
               ▼
         GitHub API
               │
               ▼
        PR Review Comment
```

GitHub memang menyediakan webhook untuk mengirim event langsung ke external/self-hosted server tanpa perlu polling. Event `pull_request` bisa dipakai untuk aktivitas PR tersebut. ([GitHub Docs][1])

### Untuk banyak repo, pakai GitHub App

Saya lebih menyarankan:

```text
GitHub App: "My AI Reviewer"

Installed on:
├── repo-a
├── repo-b
├── repo-c
├── photobox-app
├── backend
└── frontend
```

Daripada bikin webhook secara manual di setiap repo.

GitHub App kamu subscribe:

```text
Pull requests:
- opened
- synchronize
- reopened
- ready_for_review
```

Lalu semuanya diarahkan ke:

```text
POST https://review.example.com/webhook/github
```

GitHub App webhook memang bisa digunakan lintas repo tempat app tersebut ter-install. Untuk menerima `pull_request`, GitHub App minimal memerlukan akses read ke Pull Requests. ([GitHub Docs][2])

Untuk posting hasil review nanti beri permission misalnya:

```text
Contents: Read
Pull requests: Read & Write
Metadata: Read
```

Jadi kamu juga **nggak perlu nyimpan PAT personal permanen**. Worker bisa menggunakan installation token GitHub App.

---

## Service self-hosted-nya

Saya mungkin bikin sederhana seperti:

```text
ai-code-reviewer/
├── cmd/
│   ├── server/
│   └── worker/
│
├── internal/
│   ├── github/
│   │   ├── webhook.go
│   │   ├── auth.go
│   │   └── review.go
│   │
│   ├── queue/
│   ├── repository/
│   └── reviewer/
│       └── opencode.go
│
├── prompts/
│   └── review.md
│
├── repos/
│
└── config.yaml
```

Misalnya konfigurasi:

```yaml
repos:
  PortraitDeveloper/photobox-app:
    enabled: true
    base_branch: main
    model: anthropic/claude-sonnet-4-5

  myorg/backend:
    enabled: true
    model: openai/gpt-5

  myorg/legacy-app:
    enabled: false
```

Kemudian event datang:

```json
{
  "action": "synchronize",
  "repository": {
    "full_name": "PortraitDeveloper/photobox-app"
  },
  "pull_request": {
    "number": 125
  }
}
```

Server cuma melakukan:

```text
1. verify webhook signature
2. cek repo enabled
3. cek PR bukan draft
4. enqueue:
   PortraitDeveloper/photobox-app#125
5. return 200
```

Jangan jalankan OpenCode langsung di request webhook karena review bisa makan waktu cukup lama.

---

## Worker

Worker mengambil job:

```text
repo = PortraitDeveloper/photobox-app
PR   = 125
SHA  = abc123
```

Lalu workspace terisolasi:

```text
/workspaces/
└── PortraitDeveloper/
    └── photobox-app/
        └── pr-125/
```

Clone/fetch:

```bash
git clone git@github.com:PortraitDeveloper/photobox-app.git

git fetch origin \
  pull/125/head:pr-125

git checkout pr-125
```

Kemudian:

```bash
opencode run \
  --format json \
  "Review PR #125 against origin/main.

  Focus only on actionable issues:
  - bugs
  - regressions
  - security
  - concurrency
  - incorrect logic
  - missing error handling

  Do not report formatting or subjective style issues."
```

Ini cocok banget untuk OpenCode karena `opencode run` memang disediakan untuk **non-interactive scripting/automation**. ([OpenCode][3])

---

## Bahkan OpenCode-nya bisa persistent

Daripada setiap review cold start:

```text
PR
 ↓
start OpenCode
 ↓
load MCP
 ↓
load provider
 ↓
review
 ↓
exit
```

Bisa jalankan:

```bash
OPENCODE_SERVER_PASSWORD=xxx \
opencode serve \
  --hostname 127.0.0.1 \
  --port 4096
```

OpenCode menyediakan headless server untuk penggunaan seperti ini dan server-nya bisa dilindungi Basic Auth. ([OpenCode][4])

Worker kemudian:

```bash
opencode run \
  --attach http://127.0.0.1:4096 \
  --dir /workspaces/photobox/pr-125 \
  "Review this PR..."
```

Dokumentasi OpenCode juga secara eksplisit menyebut `--attach` dapat menghindari **MCP server cold boot pada setiap run**. ([OpenCode][3])

Jadi arsitektur akhirnya:

```text
                         INTERNET
                            │
                            ▼
                      GitHub App
                            │
                         webhook
                            │
                            ▼
                  ┌──────────────────┐
                  │      Nginx       │
                  │ review.domain.com│
                  └────────┬─────────┘
                           │
                           ▼
                 ┌───────────────────┐
                 │ Webhook Receiver  │
                 │       Go          │
                 └────────┬──────────┘
                          │
                          ▼
                     Job Queue
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
        Worker 1       Worker 2       Worker 3
           │              │              │
           └──────────────┼──────────────┘
                          ▼
                  OpenCode Server
                  localhost:4096
                          │
                          ▼
                       LLM API
                          │
                          ▼
                    Review Result
                          │
                          ▼
                     GitHub API
                          │
                          ▼
                PR inline comments
```

### Yang menarik: tidak perlu terlalu kompleks di awal

Untuk misalnya **5–20 repo dan jumlah PR normal**, saya malah mulai dengan:

```text
Docker Compose

github-reviewer-api
        │
        ├── SQLite
        │
        └── worker
             │
             ▼
         OpenCode
```

Belum perlu:

```text
❌ Kubernetes
❌ Kafka
❌ RabbitMQ
❌ Redis cluster
```

SQLite bahkan cukup untuk queue sederhana:

```text
review_jobs

id
repository
pr_number
head_sha
status
created_at
started_at
finished_at
```

Worker:

```text
SELECT job
WHERE status = queued

        ↓

status = running

        ↓

OpenCode

        ↓

status = completed
```

Yang **sangat penting** adalah dedup berdasarkan:

```text
repository + PR + head_sha
```

Misalnya:

```text
PR #125

commit A → review queued
commit B → review queued
commit C → review queued
```

Saat worker mau review A, cek dulu:

```text
A != current PR head SHA
```

Kalau iya:

```text
skip A
skip B

review C
```

Ini bisa menghemat token/model cost lumayan besar.

Dan kalau dibuat begini, OpenCode benar-benar hanya menjadi **review engine**. Service kamu yang mengurus orchestration:

```text
GitHub event
      ↓
repo routing
      ↓
dedup
      ↓
workspace
      ↓
OpenCode
      ↓
parse findings
      ↓
severity filter
      ↓
inline comments
```

Menurut saya ini desain yang paling pas untuk self-hosted multi-repo reviewer. Nanti bahkan gampang dikembangkan menjadi dashboard seperti:

```text
AI Reviewer

Repositories       12
PR Reviewed       284
Issues Found       71
Critical            3

Recent Reviews
────────────────────────────
photobox-app #182    ✓ 4 findings
backend #391         ✓ clean
frontend #812        ◌ reviewing
api #113             ○ queued
```

dan per-repository bisa punya `AGENTS.md`/rules masing-masing sehingga OpenCode memahami aturan codebase yang berbeda tanpa membuat service reviewer-nya berbeda.

[1]: https://docs.github.com/en/webhooks/about-webhooks?utm_source=chatgpt.com
[2]: https://docs.github.com/en/webhooks/webhook-events-and-payloads?actiontype=released&utm_source=chatgpt.com
[3]: https://dev.opencode.ai/docs/cli/?utm_source=chatgpt.com
[4]: https://dev.opencode.ai/docs/cli?utm_source=chatgpt.com
