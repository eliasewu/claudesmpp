-- Core SMS Gateway Database Initialization
CREATE DATABASE IF NOT EXISTS kannel;
USE kannel;

-- Enable necessary features
SET GLOBAL sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- Create key tables (simplified from Prisma schema for bootstrap)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role ENUM('SUPERADMIN', 'ADMIN', 'CLIENT', 'VIEWER') DEFAULT 'CLIENT',
  status ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') DEFAULT 'ACTIVE',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(255) PRIMARY KEY,
  userId VARCHAR(255),
  accountId VARCHAR(100) UNIQUE,
  name VARCHAR(255),
  balance DECIMAL(15,4) DEFAULT 0.0000,
  dailyLimit INT DEFAULT 10000,
  status ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') DEFAULT 'ACTIVE',
  apiKey VARCHAR(100) UNIQUE,
  throttleRate INT DEFAULT 10,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_accountId (accountId)
);

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(255) PRIMARY KEY,
  clientId VARCHAR(255),
  messageId VARCHAR(100) UNIQUE,
  `from` VARCHAR(20),
  `to` VARCHAR(20),
  content TEXT,
  parts INT DEFAULT 1,
  status ENUM('PENDING', 'SUBMITTED', 'DELIVERED', 'FAILED', 'EXPIRED', 'REJECTED') DEFAULT 'PENDING',
  dlrStatus VARCHAR(20),
  errorCode VARCHAR(20),
  submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  deliveredAt DATETIME,
  cost DECIMAL(10,4) DEFAULT 0.0000,
  smppAccountId VARCHAR(100),
  INDEX idx_to (`to`),
  INDEX idx_status (status),
  INDEX idx_submitted (submittedAt)
);

CREATE TABLE IF NOT EXISTS dlr_records (
  id VARCHAR(255) PRIMARY KEY,
  messageId VARCHAR(255),
  status VARCHAR(20),
  errorCode VARCHAR(20),
  receivedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  details JSON,
  FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(255) PRIMARY KEY,
  clientId VARCHAR(255),
  type ENUM('TOPUP', 'DEDUCTION', 'REFUND', 'ADJUSTMENT'),
  amount DECIMAL(15,4),
  description TEXT,
  reference VARCHAR(100),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(255) PRIMARY KEY,
  userId VARCHAR(255),
  action VARCHAR(100),
  entityType VARCHAR(50),
  entityId VARCHAR(100),
  details JSON,
  ipAddress VARCHAR(45),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_health (
  id VARCHAR(255) PRIMARY KEY,
  component VARCHAR(100),
  status VARCHAR(20),
  metrics JSON,
  lastChecked DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert demo data
INSERT IGNORE INTO users (id, email, password, name, role) VALUES 
('user1', 'admin@smsgateway.com', '$2a$10$examplehashedpasswordforadmin123replaceinprod', 'Super Admin', 'SUPERADMIN');

INSERT IGNORE INTO clients (id, userId, accountId, name, balance) VALUES 
('client1', 'user1', 'TEST001', 'Test Client', 100.00);

-- Kannel SQLBox compatibility tables
CREATE TABLE IF NOT EXISTS sent_sms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  momt ENUM('MO', 'MT') NOT NULL,
  sender VARCHAR(20),
  receiver VARCHAR(20),
  udhdata BLOB,
  msgdata TEXT,
  time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  smsc VARCHAR(20),
  boxc_id VARCHAR(100)
);

-- Grant privileges for kannel user
GRANT ALL PRIVILEGES ON kannel.* TO 'kannel'@'%';
FLUSH PRIVILEGES;

SELECT 'Database initialized with core tables. Prisma will sync the rest.' as status;
