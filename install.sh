#!/bin/bash
set -e

echo "=================================================="
echo "SMS Gateway v2.0 - Complete Installation"
echo "Kannel + Python SMPP Server + Docker Stack"
echo "=================================================="
echo ""

if [ "$(id -u)" -ne 0 ]; then
   echo "Please run as root or with sudo"
   exit 1
fi

# Get server IP
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo "Server IP: $SERVER_IP"

echo ""
echo "=== Step 1: Install System Dependencies ==="
apt-get update -qq
apt-get install -y ca-certificates curl gnupg lsb-release jq git \
    build-essential python3 python3-pip netcat-openbsd lsof \
    libxml2-dev libmariadb-dev libssl-dev pkg-config bison flex

echo ""
echo "=== Step 2: Install Docker ==="
if ! command -v docker &> /dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -qq
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
fi

echo ""
echo "=== Step 3: Configure Kannel (if installed) ==="
if [ -f /usr/sbin/bearerbox ]; then
    echo "Kannel found! Configuring..."
    mkdir -p /var/spool/kannel /var/log/kannel /etc/kannel
    chmod 777 /var/spool/kannel
    
    # Copy configs if not exist
    [ ! -f /etc/kannel/kannel.conf ] && cp kannel/bearerbox.conf /etc/kannel/kannel.conf 2>/dev/null || true
    
    # Restart Kannel
    killall bearerbox smsbox 2>/dev/null || true
    sleep 2
    /usr/sbin/bearerbox /etc/kannel/kannel.conf &
    sleep 4
    /usr/sbin/smsbox /etc/kannel/kannel.conf &
    sleep 2
    
    # Check
    if curl -s http://localhost:13000/status?password=bar > /dev/null 2>&1; then
        echo "✅ Kannel running!"
    else
        echo "⚠️  Kannel not responding - check config"
    fi
else
    echo "⚠️  Kannel not installed. SMS routing via HTTP API only."
fi

echo ""
echo "=== Step 4: Setup Python SMPP Server ==="
mkdir -p /opt/smpp-server

# Create SMPP server
cat > /opt/smpp-server/smpp_server.py << 'SMPPEOF'
#!/usr/bin/env python3
import socket, threading, logging, struct, time, urllib.request, urllib.parse, json, os
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('SMPP')
HOST, PORT = '0.0.0.0', 9095
USERS_FILE = '/etc/kannel/smpp_users.json'

def load_users():
    if os.path.exists(USERS_FILE):
        try:
            with open(USERS_FILE, 'r') as f: return json.load(f)
        except: pass
    return {'Test1': {'password': 'Test1', 'throughput': 100, 'sender': 'SMSGW', 'kannel_user': 'tester', 'kannel_pass': 'testerpass'}}

def forward_to_kannel(sender, to, text, username):
    users = load_users()
    user = users.get(username, {})
    try:
        params = urllib.parse.urlencode({'username': user.get('kannel_user','tester'), 'password': user.get('kannel_pass','testerpass'), 'from': sender or user.get('sender','SMSGW'), 'to': to, 'text': text})
        resp = urllib.request.urlopen('http://127.0.0.1:13013/cgi-bin/sendsms?'+params, timeout=10)
        return True, resp.read().decode().strip()
    except Exception as e:
        return False, str(e)

def handle_client(conn, addr):
    sid = 'unknown'
    try:
        while True:
            data = conn.recv(4096)
            if not data: break
            cmd_len = struct.unpack('>I', data[0:4])[0]
            cmd_id = struct.unpack('>I', data[4:8])[0]
            seq = struct.unpack('>I', data[12:16])[0]
            body = data[16:cmd_len] if cmd_len > 16 else b''
            
            if cmd_id in (0x00000001, 0x00000002, 0x00000009):
                parts = body.split(b'\x00')
                _sid = parts[0].decode('ascii', errors='ignore').strip() if len(parts) > 0 else ''
                pwd = parts[1].decode('ascii', errors='ignore').strip() if len(parts) > 1 else ''
                users = load_users()
                if _sid in users and users[_sid].get('password') == pwd:
                    sid = _sid
                    resp_cmd = 0x80000000 | cmd_id
                    resp = struct.pack('>IIII', 25, resp_cmd, 0, seq) + b'SMSGW\x00'
                    conn.send(resp)
                    logger.info(f"BIND OK: {sid}")
                else:
                    resp = struct.pack('>IIII', 16, 0x80000000 | cmd_id, 0x0D, seq)
                    conn.send(resp)
            elif cmd_id == 0x00000004:
                try:
                    parts = body.split(b'\x00')
                    src = parts[2].decode('ascii', errors='ignore') if len(parts) > 2 else ''
                    dst = parts[4].decode('ascii', errors='ignore') if len(parts) > 4 else ''
                    sm_len_idx = len(b'\x00'.join(parts[:7])) + 7
                    msg = body[sm_len_idx+1:sm_len_idx+1+body[sm_len_idx]].decode('ascii', errors='ignore') if sm_len_idx < len(body) else ''
                    ok, result = forward_to_kannel(src, dst, msg, sid)
                    mid = result if ok else 'FAILED'
                    resp_body = mid.encode('ascii') + b'\x00'
                    resp = struct.pack('>IIII', 16+len(resp_body), 0x80000004, 0 if ok else 8, seq) + resp_body
                    conn.send(resp)
                except: conn.send(struct.pack('>IIII', 23, 0x80000004, 8, seq) + b'ERROR\x00')
            elif cmd_id == 0x00000015:
                conn.send(struct.pack('>IIII', 16, 0x80000015, 0, seq))
            elif cmd_id == 0x00000006:
                conn.send(struct.pack('>IIII', 16, 0x80000006, 0, seq))
                break
    except: pass
    finally:
        conn.close()
        logger.info(f"DISCONNECTED: {sid}")

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind((HOST, PORT))
server.listen(50)
logger.info(f"SMPP Server on {HOST}:{PORT}")
while True:
    conn, addr = server.accept()
    threading.Thread(target=handle_client, args=(conn, addr), daemon=True).start()
SMPPEOF

# Create users file
cat > /etc/kannel/smpp_users.json << 'JSON'
{"Test1": {"password": "Test1", "throughput": 100, "sender": "SMSGW", "kannel_user": "tester", "kannel_pass": "testerpass"}, "tester": {"password": "testerpass", "throughput": 50, "sender": "SMSGW", "kannel_user": "tester", "kannel_pass": "testerpass"}}
JSON

# Kill old and start SMPP server
kill $(lsof -t -i:9095) 2>/dev/null || true
sleep 1
nohup python3 /opt/smpp-server/smpp_server.py > /var/log/smpp-server.log 2>&1 &
sleep 2

# Create systemd service
cat > /etc/systemd/system/smpp-server.service << 'UNITEOF'
[Unit]
Description=SMPP Server for SMS Gateway
After=network.target
[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/smpp-server/smpp_server.py
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNITEOF
systemctl daemon-reload
systemctl enable smpp-server 2>/dev/null || true

if netstat -tlnp 2>/dev/null | grep -q 9095; then
    echo "✅ SMPP Server running on port 9095"
else
    echo "⚠️  SMPP Server may not have started - check /var/log/smpp-server.log"
fi

echo ""
echo "=== Step 5: Build Docker Services ==="
cd "$(dirname "$0")"
docker compose down 2>/dev/null || true
docker compose build backend --no-cache
docker compose build frontend --no-cache
docker compose up -d

echo ""
echo "=== Step 6: Initialize Database ==="
sleep 30
docker compose exec backend npx prisma db push --accept-data-loss 2>/dev/null || true
sleep 5
curl -s http://localhost:3001/api/seed || true

echo ""
echo "=== Step 7: Configure Firewall ==="
ufw allow 80/tcp 2>/dev/null || true
ufw allow 3000/tcp 2>/dev/null || true
ufw allow 3001/tcp 2>/dev/null || true
ufw allow 9095/tcp 2>/dev/null || true
ufw allow 13000/tcp 2>/dev/null || true
ufw allow 13013/tcp 2>/dev/null || true
iptables -A INPUT -p tcp --dport 9095 -j ACCEPT 2>/dev/null || true

echo ""
echo "=================================================="
echo "✅ SMS Gateway v2.0 Installation Complete!"
echo "=================================================="
echo ""
echo "🌐 Web Dashboard:  http://$SERVER_IP:3000"
echo "🔑 Login:          admin@smsgateway.com / admin123"
echo ""
echo "📡 SMPP Server:    $SERVER_IP:9095"
echo "   Auth:           Test1 / Test1"
echo ""
echo "📨 SMS HTTP API:   http://$SERVER_IP:13013/cgi-bin/sendsms"
echo "   Auth:           tester / testerpass"
echo ""
echo "📊 Kannel Status:  http://$SERVER_IP:13000 (pass: bar)"
echo ""
echo "=================================================="
echo "Services:"
echo "  Docker:  MySQL, Redis, Backend, Frontend, NGINX"
echo "  Native:  Kannel Bearerbox, Kannel SMSBox, Python SMPP"
echo "=================================================="
echo ""
echo "Quick Commands:"
echo "  docker compose ps              # Check Docker services"
echo "  systemctl status smpp-server   # Check SMPP server"
echo "  tail -f /var/log/smpp-server.log  # SMPP logs"
echo "  curl localhost:13000/status?password=bar  # Kannel status"
echo ""
echo "Change default passwords before production use!"
echo "=================================================="
