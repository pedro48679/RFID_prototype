# 📱 RFID Access Control App (Raspberry Pi & React Native)

**Embedded Systems Project**

---

## 1. Overview

This mobile application monitors and controls an **RFID access control system** powered by a **Raspberry Pi**. 

### Core Features

- **Near Real-Time Monitoring**:
  - Live access logs (permitted / blocked).
  - Data tables with timestamp + RFID ID.
- **Interactive Dashboard**:
  - Live console feed directly from the hardware.
  - "Permitted" and "Blocked" views with expandable modals.
- **Actuator Control**:
  - Manual override button to force actuator opening (e.g., electronic lock) for 10 seconds.
- **Dynamic Configuration**:
  - Configurable Raspberry Pi IP address and port directly within the app.
  - Persistent local storage using `AsyncStorage`.
- **Robust Error Handling**:
  - Visual connection indicator (Green/Red).
  - Alerts for connection failures and request timeouts.

---

## 2. Environment Requirements

### 2.1. Development Tools

- **Framework**: React Native (Expo / Expo Router)
- **Language**: TypeScript (`.tsx`) and JavaScript (`.js`)
- **Node.js**: 18+
- **Expo CLI** installed globally

### 2.2. Execution

- **Android**: Physical device or emulator running Android 8.0+ (API 26+).
- **Raspberry Pi Hardware**:
  - Active HTTP/REST server serving the RFID logic.
  - Must be on the same local network segment (Wi‑Fi/LAN) as the Android device.

---

## 3. Project Structure

```text
releases/
  App.apk                # Compiled Android APK ready for installation

src/
  _layout.tsx            # Navigation and global layout architecture
  APP.js                 # Standalone React Native entry point
  index.tsx              # Main Dashboard Component
  settings.tsx           # Configuration Screen Component

assets/                  # Application screenshots and UI assets
README.md                # Project documentation
```

> **Note:** IP and port persistence is handled locally via `AsyncStorage`.

---

## 4. Running the Development Server

1. Navigate to the source code directory (`src/`):
   ```bash
   cd src
   npm install
   npx expo start
   ```
2. In the Expo CLI interface:
   - Press **`a`** to open in an Android emulator, **or**
   - Use the **Expo Go** app on your physical device and scan the QR Code.
3. Ensure that:
   - The device/emulator and the Raspberry Pi are on the **same network**.
   - The Raspberry Pi's IP is reachable from the mobile device.

---

## 5. Network Configuration (IP/Port)

On the main Dashboard screen:

1. Tap the gear icon in the top right corner to open the settings screen.
2. Enter the hardware details:
   - **Raspberry Pi IP Address** (e.g., `192.168.1.10`)
   - **Port** (e.g., `5000`)
3. Tap **"SAVE CONFIGURATION"**.

The application will:
- Validate input fields.
- Persist the IP and port securely in **AsyncStorage**.
- Return to the Dashboard and apply the new configuration.

---

## 6. Hardware API Endpoints

The mobile app communicates with the Raspberry Pi via HTTP REST using the following endpoints:

### 6.1. Console Logs

- **Method**: `GET`  
- **URL**: `http://<RASPBERRY_IP>:<PORT>/get_log`  
- **Response**: Multi-line plain text log stream.
  ```text
  2025-05-21 14:30:15 - PERMITTED: ID 12345678 - Welcome!
  2025-05-21 14:31:22 - BLOCKED: ID 87654321 - Access Denied
  2025-05-21 14:32:10 - MANUAL OVERRIDE - Commanded by user
  ```

### 6.2. Access Data Tables

- **Method**: `GET`  
- **URL**: `http://<RASPBERRY_IP>:<PORT>/get_table_data`  
- **Response (JSON)**:
  ```json
  {
    "accepted": [
      { "timestamp": "2025-05-21 14:30:15", "ID": "12345678" }
    ],
    "blocked": [
      { "timestamp": "2025-05-21 14:31:22", "ID": "87654321" }
    ]
  }
  ```

### 6.3. Actuator Command

- **Method**: `POST`  
- **URL**: `http://<RASPBERRY_IP>:<PORT>/force_open`  
- **Response (JSON)**:
  ```json
  { "status": "success", "message": "Actuator forced open for 10 seconds" }
  ```

---

## 7. Error Management

- **Connection Loss / Timeout**:
  - The status indicator in the header turns red.
  - A **"Retry"** action button appears.
  - Alerts are triggered upon actuation failure.
- **Malformed Responses** (Invalid JSON, HTTP 4xx/5xx):
  - Fails safe: the app flags `isConnected = false` and pauses data polling to prevent crashes.

---

## 8. Authors

- **Daniel Balicevic**  
- **Pedro Silva**  

Course: **Embedded Systems**  
Institution: **Ismat**
