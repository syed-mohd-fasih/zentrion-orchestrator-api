# Zentrion Orchestrator API - Usage Examples

## Dashboard Integration Examples

### React/Next.js Integration

#### 1. Authentication Hook

```typescript
// hooks/useAuth.ts
import { useState, useEffect } from 'react';

interface User {
  id: string;
  username: string;
  role: string;
  email: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      fetchCurrentUser(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  async function login(username: string, password: string) {
    const response = await fetch('http://localhost:3001/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) throw new Error('Login failed');

    const data = await response.json();
    setToken(data.accessToken);
    setUser(data.user);
    localStorage.setItem('token', data.accessToken);
    return data;
  }

  async function fetchCurrentUser(authToken: string) {
    try {
      const response = await fetch('http://localhost:3001/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setToken(authToken);
      }
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
  }

  return { user, token, loading, login, logout };
}
```

#### 2. WebSocket Hook

```typescript
// hooks/useWebSocket.ts
import { useEffect, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';

export function useWebSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const newSocket = io('http://localhost:3001', {
      transports: ['websocket'],
    });

    newSocket.on('connect', () => {
      console.log('WebSocket connected');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const subscribe = useCallback(
    (event: string, callback: (data: any) => void) => {
      if (socket) {
        socket.on(event, callback);
        return () => socket.off(event, callback);
      }
    },
    [socket],
  );

  return { socket, connected, subscribe };
}
```

#### 3. Real-time Telemetry Component

```typescript
// components/TelemetryStream.tsx
import { useEffect, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

interface Log {
  id: string;
  timestamp: string;
  service: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
}

export function TelemetryStream() {
  const { subscribe } = useWebSocket();
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    const unsubscribe = subscribe?.('telemetry.log', (log: Log) => {
      setLogs((prev) => [log, ...prev].slice(0, 100));
    });
    return unsubscribe;
  }, [subscribe]);

  return (
    <div className="space-y-2">
      <h2 className="text-xl font-bold">Live Telemetry</h2>
      <div className="h-96 overflow-y-auto space-y-1">
        {logs.map((log) => (
          <div
            key={log.id}
            className={`p-2 rounded text-sm ${
              log.status >= 400 ? 'bg-red-100' : 'bg-gray-50'
            }`}
          >
            <span className="font-mono text-xs text-gray-500">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span className="ml-2 font-semibold">{log.service}</span>
            <span className="ml-2">{log.method} {log.path}</span>
            <span className="ml-2 text-gray-600">{log.status}</span>
            <span className="ml-2 text-gray-500">{log.latencyMs}ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### 4. Anomaly List Component

```typescript
// components/AnomalyList.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';

interface Anomaly {
  id: string;
  timestamp: string;
  service: string;
  type: string;
  severity: string;
  details: string;
}

export function AnomalyList() {
  const { token } = useAuth();
  const { subscribe } = useWebSocket();
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);

  useEffect(() => {
    // Fetch initial anomalies
    fetch('http://localhost:3001/anomalies?limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setAnomalies(data.anomalies));

    // Subscribe to new anomalies
    const unsubscribe = subscribe?.('anomaly.created', (anomaly: Anomaly) => {
      setAnomalies((prev) => [anomaly, ...prev]);
    });

    return unsubscribe;
  }, [token, subscribe]);

  const severityColor = (severity: string) => {
    const colors = {
      low: 'bg-blue-100 text-blue-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-orange-100 text-orange-800',
      critical: 'bg-red-100 text-red-800',
    };
    return colors[severity as keyof typeof colors] || 'bg-gray-100';
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Detected Anomalies</h2>
      <div className="space-y-3">
        {anomalies.map((anomaly) => (
          <div key={anomaly.id} className="border rounded-lg p-4 hover:shadow-md">
            <div className="flex justify-between items-start">
              <div>
                <span className={`px-2 py-1 rounded text-xs font-semibold ${severityColor(anomaly.severity)}`}>
                  {anomaly.severity.toUpperCase()}
                </span>
                <span className="ml-2 font-semibold">{anomaly.type}</span>
                <p className="text-sm text-gray-600 mt-1">{anomaly.details}</p>
              </div>
              <div className="text-xs text-gray-500">
                {new Date(anomaly.timestamp).toLocaleString()}
              </div>
            </div>
            <div className="mt-2">
              <span className="text-sm text-gray-500">Service: </span>
              <span className="text-sm font-mono">{anomaly.service}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### 5. Policy Review Component

```typescript
// components/PolicyReview.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';

interface PolicyDraft {
  id: string;
  service: string;
  reason: string;
  yaml: string;
  status: string;
  createdAt: string;
}

export function PolicyReview() {
  const { token, user } = useAuth();
  const [drafts, setDrafts] = useState<PolicyDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<PolicyDraft | null>(null);

  useEffect(() => {
    fetchDrafts();
  }, [token]);

  async function fetchDrafts() {
    const response = await fetch('http://localhost:3001/policies/drafts/pending', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    setDrafts(data.drafts);
  }

  async function approveDraft(draftId: string) {
    await fetch(`http://localhost:3001/policies/drafts/${draftId}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notes: 'Approved via dashboard' }),
    });
    fetchDrafts();
    setSelectedDraft(null);
  }

  async function rejectDraft(draftId: string, reason: string) {
    await fetch(`http://localhost:3001/policies/drafts/${draftId}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });
    fetchDrafts();
    setSelectedDraft(null);
  }

  const canApprove = user?.role === 'ADMIN';

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <h2 className="text-xl font-bold mb-4">Pending Policy Drafts</h2>
        <div className="space-y-2">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              onClick={() => setSelectedDraft(draft)}
              className={`p-3 border rounded cursor-pointer hover:bg-gray-50 ${
                selectedDraft?.id === draft.id ? 'border-blue-500' : ''
              }`}
            >
              <div className="font-semibold">{draft.service}</div>
              <div className="text-sm text-gray-600">{draft.reason}</div>
              <div className="text-xs text-gray-400 mt-1">
                {new Date(draft.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        {selectedDraft && (
          <div>
            <h3 className="text-lg font-bold mb-2">Policy Details</h3>
            <div className="bg-gray-50 p-4 rounded mb-4">
              <div className="mb-2">
                <span className="font-semibold">Service:</span> {selectedDraft.service}
              </div>
              <div className="mb-2">
                <span className="font-semibold">Reason:</span> {selectedDraft.reason}
              </div>
              <div>
                <span className="font-semibold">YAML:</span>
                <pre className="mt-2 p-2 bg-gray-900 text-green-400 rounded text-xs overflow-x-auto">
                  {selectedDraft.yaml}
                </pre>
              </div>
            </div>

            {canApprove && (
              <div className="flex gap-2">
                <button
                  onClick={() => approveDraft(selectedDraft.id)}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Approve & Apply
                </button>
                <button
                  onClick={() => {
                    const reason = prompt('Rejection reason:');
                    if (reason) rejectDraft(selectedDraft.id, reason);
                  }}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

## CLI Examples

### Bash Script for Testing

```bash
#!/bin/bash

API_URL="http://localhost:3001"

# Login and get token
echo "🔐 Logging in..."
TOKEN=$(curl -s -X POST $API_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | jq -r '.accessToken')

echo "✅ Token: ${TOKEN:0:20}..."

# Get services
echo -e "\n📊 Fetching services..."
curl -s -H "Authorization: Bearer $TOKEN" \
  $API_URL/telemetry/services | jq '.services[] | {name, requestsPerSecond, errorRate}'

# Get anomalies
echo -e "\n🚨 Fetching anomalies..."
curl -s -H "Authorization: Bearer $TOKEN" \
  $API_URL/anomalies?limit=5 | jq '.anomalies[] | {type, severity, service, details}'

# Get pending drafts
echo -e "\n📋 Fetching pending policy drafts..."
curl -s -H "Authorization: Bearer $TOKEN" \
  $API_URL/policies/drafts/pending | jq '.drafts[] | {id, service, reason}'

echo -e "\n✨ Done!"
```

### Python Script

```python
#!/usr/bin/env python3
import requests
import time

API_URL = "http://localhost:3001"

class OrchestratorClient:
    def __init__(self):
        self.token = None
        self.session = requests.Session()

    def login(self, username, password):
        response = self.session.post(
            f"{API_URL}/auth/login",
            json={"username": username, "password": password}
        )
        response.raise_for_status()
        data = response.json()
        self.token = data["accessToken"]
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
        return data["user"]

    def get_services(self):
        response = self.session.get(f"{API_URL}/telemetry/services")
        response.raise_for_status()
        return response.json()["services"]

    def get_anomalies(self, limit=None):
        url = f"{API_URL}/anomalies"
        if limit:
            url += f"?limit={limit}"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()["anomalies"]

    def get_pending_drafts(self):
        response = self.session.get(f"{API_URL}/policies/drafts/pending")
        response.raise_for_status()
        return response.json()["drafts"]

    def approve_draft(self, draft_id):
        response = self.session.post(
            f"{API_URL}/policies/drafts/{draft_id}/approve",
            json={"notes": "Approved via Python script"}
        )
        response.raise_for_status()
        return response.json()

def main():
    client = OrchestratorClient()

    # Login
    user = client.login("admin", "admin123")
    print(f"✅ Logged in as: {user['username']} ({user['role']})")

    # Monitor anomalies
    print("\n🔍 Monitoring for anomalies...")
    while True:
        anomalies = client.get_anomalies(limit=5)
        if anomalies:
            print(f"\n🚨 Found {len(anomalies)} anomalies:")
            for anomaly in anomalies:
                print(f"  - [{anomaly['severity'].upper()}] {anomaly['type']}: {anomaly['details']}")

        time.sleep(10)

if __name__ == "__main__":
    main()
```

### Node.js/TypeScript Script

```typescript
// monitor.ts
import axios from 'axios';

const API_URL = 'http://localhost:3001';

class OrchestratorClient {
  private token: string = '';

  async login(username: string, password: string) {
    const response = await axios.post(`${API_URL}/auth/login`, {
      username,
      password,
    });
    this.token = response.data.accessToken;
    return response.data.user;
  }

  private get headers() {
    return { Authorization: `Bearer ${this.token}` };
  }

  async getServices() {
    const response = await axios.get(`${API_URL}/telemetry/services`, {
      headers: this.headers,
    });
    return response.data.services;
  }

  async getAnomalies(limit?: number) {
    const response = await axios.get(`${API_URL}/anomalies`, {
      headers: this.headers,
      params: { limit },
    });
    return response.data.anomalies;
  }

  async getPendingDrafts() {
    const response = await axios.get(`${API_URL}/policies/drafts/pending`, {
      headers: this.headers,
    });
    return response.data.drafts;
  }

  async approveDraft(draftId: string) {
    const response = await axios.post(
      `${API_URL}/policies/drafts/${draftId}/approve`,
      { notes: 'Auto-approved' },
      { headers: this.headers },
    );
    return response.data;
  }
}

// Usage
async function main() {
  const client = new OrchestratorClient();

  const user = await client.login('admin', 'admin123');
  console.log(`✅ Logged in as: ${user.username}`);

  setInterval(async () => {
    const services = await client.getServices();
    console.log('\n📊 Service Status:');
    services.forEach((service: any) => {
      console.log(
        `  ${service.name}: ${service.requestsPerSecond} req/s, ${service.errorRate}% errors`,
      );
    });
  }, 5000);
}

main().catch(console.error);
```

## Testing Anomaly-to-Policy Workflow

```bash
#!/bin/bash

API_URL="http://localhost:3001"

# Login
TOKEN=$(curl -s -X POST $API_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | jq -r '.accessToken')

echo "✅ Logged in"

# Wait for anomalies
echo "⏳ Waiting for anomalies to be detected..."
sleep 15

# Get the first anomaly
ANOMALY_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  $API_URL/anomalies?limit=1 | jq -r '.anomalies[0].id')

if [ "$ANOMALY_ID" != "null" ]; then
  echo "🚨 Found anomaly: $ANOMALY_ID"

  # Generate policy from anomaly
  echo "📝 Generating policy draft..."
  DRAFT_ID=$(curl -s -X POST $API_URL/policies/drafts/from-anomaly \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"anomalyId\":\"$ANOMALY_ID\"}" \
    | jq -r '.draft.id')

  echo "✅ Draft created: $DRAFT_ID"

  # Review the draft
  echo -e "\n📋 Draft details:"
  curl -s -H "Authorization: Bearer $TOKEN" \
    $API_URL/policies/drafts/$DRAFT_ID | jq '.draft | {service, reason, status}'

  # Approve the draft
  echo -e "\n✅ Approving draft..."
  curl -s -X POST $API_URL/policies/drafts/$DRAFT_ID/approve \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"notes":"Approved via script"}' | jq '.message'

  echo -e "\n🎉 Policy applied to cluster!"
else
  echo "❌ No anomalies found yet"
fi
```

---

These examples should give you everything you need to integrate the Orchestrator API with your dashboard and automate workflows! 🚀
