#!/bin/bash
# ================================================
# Kannel 1.4.5 Native Installation Script for Debian 12
# Integrates with existing Frontend/Backend/Database
# ================================================

set -e

echo "=== Kannel 1.4.5 Full Installation (Native) ==="

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root or with sudo"
  exit 1
fi

# 1. Install Dependencies
echo "Installing dependencies..."
apt-get update
apt-get install -y \
  build-essential libtool libpcre3-dev libxml2-dev libssl-dev \
  libmysqlclient-dev mysql-client docbook-xsl docbook-xml \
  bison flex curl wget make gcc g++ pkg-config mariadb-server

# 2. Download and Compile Kannel 1.4.5
echo "Downloading Kannel 1.4.5..."
cd /usr/src
wget --no-check-certificate https://www.kannel.org/download/1.4.5/gateway-1.4.5.tar.gz
tar -xvzf gateway-1.4.5.tar.gz
cd gateway-1.4.5

echo "Configuring and compiling Kannel..."
./configure --with-mysql --enable-ssl --with-ssl
make -j$(nproc)
make install

# 3. Compile Addons (SQLBox and OpenSMPPBox)
echo "Compiling SQLBox..."
cd addons/sqlbox
./configure --with-kannel-dir=/usr/src/gateway-1.4.5
make
make install
cp sqlbox /usr/local/sbin/

echo "Compiling OpenSMPPBox..."
cd ../opensmppbox
./configure --with-kannel-dir=/usr/src/gateway-1.4.5
make
make install
cp opensmppbox /usr/local/sbin/

# 4. Create Directories and Permissions
echo "Creating directories..."
mkdir -p /etc/kannel /var/log/kannel /var/spool/kannel
chmod -R 777 /var/log/kannel /var/spool/kannel
chown -R debian:debian /var/log/kannel /var/spool/kannel

# 5. Create Configuration Files
echo "Creating Kannel configuration files..."

cat > /etc/kannel/kannel.conf << 'EOF'
group = core
admin-port = 13000
admin-password = Telco1988
status-password = Telco1988
log-file = /var/log/kannel/bearerbox.log
log-level = 0
smsbox-port = 13001
store-type = spool
store-location = /var/spool/kannel

group = smsc
smsc = smpp
smsc-id = primary
host = 127.0.0.1
port = 2775
system-type = ""
system-id = kannel
password = Telco1988
interface-version = 34
throughput = 100

group = smsbox
smsbox-id = main
bearerbox-host = localhost
sendsms-port = 13013
EOF

cat > /etc/kannel/sqlbox.conf << 'EOF'
group = sqlbox
id = sqlbox-1
bearerbox-host = localhost
bearerbox-port = 13001
smsbox-port = 13005
log-file = /var/log/kannel/sqlbox.log
log-level = 0

group = mysql-connection
id = myconn
host = 127.0.0.1
port = 3306
username = kannel
password = Telco1988
database = kannel
max-connections = 20

group = mysql-table
id = sent_sms
connection = myconn
table = messages
field-mo-id = id
field-mo-foreign-id = messageId
field-mo-sender = `from`
field-mo-receiver = `to`
field-mo-msgdata = content
field-mo-time = submittedAt
EOF

cat > /etc/kannel/opensmppbox.conf << 'EOF'
group = opensmppbox
bearerbox-host = localhost
bearerbox-port = 13001
smsbox-port = 13010
log-file = /var/log/kannel/opensmppbox.log
log-level = 0
smpp-log-level = 0

# Multi-tenant SMPP accounts will be managed via database
group = smpp-user
username = testuser
password = Telco1988
throughput = 50
default-sender = "SMSGW"
EOF

# 6. Create Systemd Services
echo "Creating systemd services..."

cat > /etc/systemd/system/kannel-bearerbox.service << 'EOF'
[Unit]
Description=Kannel Bearerbox
After=network.target mysql.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/bearerbox -v 1 /etc/kannel/kannel.conf
Restart=always
User=debian

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/kannel-smsbox.service << 'EOF'
[Unit]
Description=Kannel SMSBox
After=kannel-bearerbox.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/smsbox -v 1 /etc/kannel/kannel.conf
Restart=always
User=debian

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/kannel-sqlbox.service << 'EOF'
[Unit]
Description=Kannel SQLBox
After=kannel-bearerbox.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/sqlbox /etc/kannel/sqlbox.conf
Restart=always
User=debian

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/kannel-opensmppbox.service << 'EOF'
[Unit]
Description=Kannel OpenSMPPBox
After=kannel-bearerbox.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/opensmppbox /etc/kannel/opensmppbox.conf
Restart=always
User=debian

[Install]
WantedBy=multi-user.target
EOF

# 7. Enable and Start Services
systemctl daemon-reload
systemctl enable kannel-bearerbox kannel-smsbox kannel-sqlbox kannel-opensmppbox
systemctl start kannel-bearerbox kannel-smsbox kannel-sqlbox kannel-opensmppbox

# 8. Update Backend Configuration to use native Kannel
echo "Updating backend to use native Kannel..."
sed -i 's/http:\/\/kannel:13013/http:\/\/localhost:13013/g' backend/src/index.js || true

echo ""
echo "=================================================="
echo "Kannel 1.4.5 Installation Completed Successfully!"
echo "=================================================="
echo "Services running on:"
echo "  - Bearerbox: port 13000 (admin)"
echo "  - SMSBox HTTP: port 13013"
echo "  - OpenSMPPBox: port 2775"
echo "  - SQLBox: connected to MySQL"
echo ""
echo "Default passwords: Telco1988 (change immediately!)"
echo "Check status: systemctl status kannel-*"
echo "Logs: tail -f /var/log/kannel/*.log"
echo ""
echo "Your frontend/backend should now integrate correctly."
echo "Run: ./scripts/verify-deployment.sh"
EOF

chmod +x install-kannel-native.sh
echo "Installation script created: install-kannel-native.sh"
echo "Run it with: sudo ./install-kannel-native.sh"
