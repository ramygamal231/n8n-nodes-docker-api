![n8n Docker Node](./assets/banner.png)

# 🐳 n8n-nodes-docker-api

![npm](https://img.shields.io/npm/v/n8n-nodes-docker-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Interact with Docker via direct API (no Portainer required) — manage containers, stream logs, and automate infrastructure with ease.

---

## ✨ Why this node?

Managing Docker via raw HTTP calls in n8n is painful and error-prone.

This node gives you:

* 🔍 **Clean container listing** (normalized output)
* 📜 **Readable logs** (stdout/stderr separated, no binary noise)
* ⚡ **Simple control** (start/stop containers safely)
* 🔐 **Built-in access control** (read-only vs full control)

👉 Turn Docker into a **first-class automation tool inside n8n**

---

## 🚀 Quick Start

1. Install the node:

```bash
npm install n8n-nodes-docker-api
```

2. Add **Docker API credentials**
3. Add the **Docker node** to your workflow
4. Choose an operation and execute

✅ No manual API calls needed

---

## 📦 Installation

### Community Nodes (Recommended)

1. Go to **Settings → Community Nodes**
2. Install: `n8n-nodes-docker-api`

---

### Manual Installation

```bash
npm install n8n-nodes-docker-api
```

---

## 🧪 Usage

### Docker Node in n8n

![Docker Node UI](./assets/node-ui.png)

1. Add the **Docker node**
2. Select an operation:

   * List Containers
   * Get Container Logs
   * Start Container
   * Stop Container
3. Configure credentials
4. Execute the node

---

### Example: List Containers

* Operation: `List Containers`
* Optional filters:

  * Name
  * Status
  * Show all containers

---

## 🔐 Credentials

### Credentials UI in n8n

![Docker Credentials UI](./assets/credentials-ui.png)

---

### Connection Modes

#### 🟢 Unix Socket (Local)

* Default for local Docker setups
* Path: `/var/run/docker.sock`

---

#### 🌐 TCP (Remote)

* Connect to remote Docker daemon
* Example:

  * Host: `192.168.1.10`
  * Port: `2375`

⚠️ Requires Docker daemon configured with:

```bash
-H tcp://0.0.0.0:2375
```

---

#### 🔒 TLS (Coming in v2)

* Secure remote connection using certificates

---

### Access Modes

#### 🟡 Read Only (Recommended)

* ✅ List containers
* ✅ Get logs
* ❌ Cannot start/stop containers

---

#### 🔴 Full Control

* ✅ All operations enabled

---

## 📋 Supported Operations (v1)

| Operation          | Description                             | Access       |
| ------------------ | --------------------------------------- | ------------ |
| List Containers    | Get containers with normalized output   | Read Only    |
| Get Container Logs | Logs with stream filtering & timestamps | Read Only    |
| Start Container    | Start stopped containers                | Full Control |
| Stop Container     | Stop running containers (with dry run)  | Full Control |

---

## 🔥 Real Use Cases

### ♻️ Self-Healing Containers

Automatically restart crashed services:

```
List Containers → IF (status != running) → Start Container
```

---

### 🚨 Log-Based Alerting

Detect errors and notify:

```
Get Logs → Search "ERROR" → Send Slack alert
```

---

### 📊 Container Monitoring

Track system health:

```
Schedule → List Containers → Aggregate → Report
```

---

## 🧠 Output Examples

### List Containers

```json
{
  "id": "3025272c7592...",
  "shortId": "3025272c7592",
  "name": "qdrant",
  "image": "qdrant/qdrant",
  "status": "running",
  "createdAt": "2026-03-13T23:19:38.000Z"
}
```

---

### Logs

```json
{
  "message": "Server started",
  "stream": "stdout"
}
```

---

## 🔒 Security

⚠️ Docker access = **host-level control**

### Best Practices

* Use **Read Only mode** unless needed
* Avoid exposing Docker over public TCP
* Use a proxy like:

  * `tecnativa/docker-socket-proxy`
* Restrict network access

---

## 🧪 Testing

```bash
npm test
```

---

## 🗺️ Roadmap

### v2

* Restart Container
* Remove Container
* Image operations (list/pull/remove)
* TLS support
* Container autocomplete

### v3

* Run container (ephemeral jobs)
* Execute commands in container
* Container stats

### v4

* Docker Trigger node (events)

---

## ⭐ Contributing

PRs and ideas are welcome — especially for new operations and improvements.

---

## 📄 License

MIT

---

## 💬 Support

Open an issue on GitHub for:

* Bugs
* Feature requests
* Questions
