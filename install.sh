#!/bin/bash
set -e

echo "=================================================="
echo "SMS Gateway Core Production Installer (Debian 12)"
echo "=================================================="
echo "This installs the core system using Docker."
echo ""

# Check requirements
if [ "$(id -u)" -ne 0 ]; then
   echo "Please run as root or with sudo"
   exit 1
fi

echo "Installing system dependencies..."
apt-get update -qq
apt-get install -y ca-certificates curl gnupg lsb-release jq

echo "Installing Docker official repository..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -qq

echo "Installing Docker Engine + Compose Plugin..."
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "Starting Docker service..."
systemctl enable --now docker
systemctl status docker --no-pager

echo "Building and starting SMS Gateway stack..."
cd "$(dirname "$0")"

echo "Starting services with docker compose..."
docker compose -f docker-compose.yml up -d --build

echo "Waiting for services to initialize (45 seconds)..."
sleep 45

echo "Seeding demo data..."
curl -s http://localhost:3001/api/seed || echo "Seed endpoint not yet ready (this is normal on first boot)"

echo ""
echo "✅ Installation completed successfully!"
echo ""
echo "Frontend Web Panel: http://$(curl -s ifconfig.me || echo 'YOUR_SERVER_IP')"
echo "Login: admin@smsgateway.com / admin123"
echo ""
echo "Run verification: ./scripts/verify-deployment.sh"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f backend     # See live logs"
echo "  docker compose logs -f kannel      # Kannel logs"
echo "  docker compose ps                  # Check all services"
echo "  docker compose down                # Stop everything"
echo ""
echo "Your server IP: 192.95.36.154"
echo "Remember to change all default passwords immediately!"
