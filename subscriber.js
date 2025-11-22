let mqttClient;
let temperatureChart, humidityChart;
let temperatureData = [];
let humidityData = [];
let timeLabels = [];
let maxDataPoints = 20;
let isAlarmActive = false;
let isGasAlarmActive = false;
let isBuzzerEnabled = true;
let currentGasLevel = 0;
let isFanAutoMode = false;
let isPumpAutoMode = false;

// Biến theo dõi trạng thái thiết bị
let deviceStates = {
  led: false,
  fan: false,
  pump: false,
  buzzer: false
};

// Chart.js configuration
Chart.defaults.color = "#1a472a";
Chart.defaults.borderColor = "rgba(46, 139, 87, 0.2)";

window.addEventListener("load", (event) => {
  // Initialize UI first
  initializeUI();

  // Initialize charts
  initializeCharts();

  // Update current time
  updateCurrentTime();
  setInterval(updateCurrentTime, 1000);

  // Connect to broker
  connectToBroker();

  // Event listeners
  document.getElementById("subscribeBtn").addEventListener("click", subscribeToTopic);
  document.getElementById("unsubscribeBtn").addEventListener("click", unsubscribeToTopic);
  document.getElementById("allOnBtn").addEventListener("click", () => controlAllDevices(true));
  document.getElementById("allOffBtn").addEventListener("click", () => controlAllDevices(false));
  document.getElementById("testAlarmBtn").addEventListener("click", testAlarm);
  document.getElementById("silenceAlarmBtn").addEventListener("click", silenceAlarm);

  // Device control switches
  document.getElementById("lightSwitch").addEventListener("change", function () {
    toggleDevice("led", this.checked);
  });

  document.getElementById("fanSwitch").addEventListener("change", function () {
    toggleDevice("fan", this.checked);
  });

  document.getElementById("pumpSwitch").addEventListener("change", function () {
    toggleDevice("pump", this.checked);
  });

  document.getElementById("buzzerSwitch").addEventListener("change", function () {
    toggleDevice("buzzer", this.checked);
  });
});

function initializeUI() {
  // Disable subscribe button initially
  const subscribeBtn = document.getElementById("subscribeBtn");
  subscribeBtn.disabled = true;
  subscribeBtn.textContent = "Đang kết nối...";
  
  // Initialize all device states to off
  updateDeviceUI('led', false);
  updateDeviceUI('fan', false);
  updateDeviceUI('pump', false);
  updateDeviceUI('buzzer', false);
  
  // Show initial connection message
  addMessageToHistory("Hệ thống đã khởi động. Đang kết nối đến máy chủ MQTT...");
}

function updateCurrentTime() {
  const now = new Date();
  const timestamp = now.toLocaleTimeString() + " " + now.toLocaleDateString();
  const timeElement = document.getElementById("currentTime");
  if (timeElement) {
    timeElement.textContent = timestamp;
  }
}

// Hàm gửi lệnh điều khiển thiết bị qua JSON
function controlDevice(device, state) {
  if (!mqttClient || !mqttClient.connected) {
    showFeedback("Chưa kết nối MQTT! Vui lòng chờ kết nối.", true);
    return false;
  }

  const command = {
    [device]: state
  };

  mqttClient.publish("device_control", JSON.stringify(command), { qos: 0 });
  console.log(`Device control sent: ${device} = ${state}`);
  
  // Cập nhật UI ngay lập tức
  updateDeviceUI(device, state);
  
  return true;
}

// Hàm cập nhật UI thiết bị
function updateDeviceUI(device, state) {
  // Cập nhật trạng thái hiển thị chính
  const statusElement = document.getElementById(`${device}Status`);
  if (statusElement) {
    statusElement.textContent = state ? "BẬT" : "TẮT";
    statusElement.classList.toggle("on", state);
  }

  // Cập nhật công tắc
  const switchElement = document.getElementById(`${device}Switch`);
  if (switchElement) {
    switchElement.checked = state;
  }

  // Cập nhật hiển thị real-time
  const realTimeElement = document.getElementById(`${device}RealTime`);
  if (realTimeElement) {
    realTimeElement.textContent = state ? "ĐANG BẬT" : "ĐANG TẮT";
    realTimeElement.className = `status-value ${state ? 'on' : ''}`;
  }

  // Cập nhật biến trạng thái
  deviceStates[device] = state;
}

// Hàm điều khiển thiết bị với phản hồi từ ESP32
function toggleDevice(device, state) {
  const success = controlDevice(device, state);
  
  if (!success) {
    // Khôi phục trạng thái công tắc nếu gửi lệnh thất bại
    const switchElement = document.getElementById(`${device}Switch`);
    if (switchElement) {
      switchElement.checked = !state;
    }
    updateDeviceUI(device, !state);
  }
  
  // Thêm vào lịch sử
  const deviceNames = {
    'led': 'Đèn chiếu sáng',
    'fan': 'Quạt thông gió', 
    'pump': 'Bơm nước uống',
    'buzzer': 'Còi báo động'
  };
  
  addMessageToHistory(`Điều khiển: ${deviceNames[device]} ${state ? 'BẬT' : 'TẮT'}`);
  showFeedback(`${deviceNames[device]} đã ${state ? 'BẬT' : 'TẮT'}`);
}

// Hàm điều khiển tất cả thiết bị
function controlAllDevices(state) {
  controlDevice('led', state);
  controlDevice('fan', state);
  controlDevice('pump', state);
  controlDevice('buzzer', state);
  
  const action = state ? 'BẬT' : 'TẮT';
  addMessageToHistory(`Đã ${action} TẤT CẢ thiết bị`);
  showFeedback(`Đã ${action} tất cả thiết bị`);
}

// Hàm kiểm tra cảnh báo cháy dựa trên nhiệt độ
function checkFireAlarm(temperature) {
  const alarmIndicator = document.getElementById("alarmIndicator");
  
  if (temperature > 45) { // Ngưỡng nhiệt độ cảnh báo cháy
    if (!isAlarmActive) {
      activateFireAlarm();
    }
  } else {
    if (isAlarmActive) {
      deactivateFireAlarm();
    }
  }
}

// Hàm kích hoạt cảnh báo cháy
function activateFireAlarm() {
  isAlarmActive = true;
  const alarmIndicator = document.getElementById("alarmIndicator");
  
  alarmIndicator.textContent = "CẢNH BÁO QUÁ NÓNG! 🔥";
  alarmIndicator.classList.add("alert");
  
  // Kích hoạt buzzer nếu được bật
  if (isBuzzerEnabled) {
    controlDevice('buzzer', true);
  }
  
  addMessageToHistory("🚨 CẢNH BÁO: Nhiệt độ trang trại quá cao! Cần can thiệp ngay!");
}

// Hàm tắt cảnh báo cháy
function deactivateFireAlarm() {
  isAlarmActive = false;
  const alarmIndicator = document.getElementById("alarmIndicator");
  
  alarmIndicator.textContent = "BÌNH THƯỜNG";
  alarmIndicator.classList.remove("alert");
  
  addMessageToHistory("Cảnh báo nhiệt độ đã tắt. Nhiệt độ trang trại trở lại bình thường.");
}

// Hàm kiểm tra cảnh báo khí gas
function checkGasAlarm(gasLevel) {
  const GAS_THRESHOLD = 1500; // Ngưỡng cảnh báo khí gas
  
  if (gasLevel > GAS_THRESHOLD && !isGasAlarmActive) {
    activateGasAlarm();
  } else if (gasLevel <= GAS_THRESHOLD && isGasAlarmActive) {
    deactivateGasAlarm();
  }
}

// Hàm kích hoạt cảnh báo khí gas
function activateGasAlarm() {
  isGasAlarmActive = true;
  const gasAlarmIndicator = document.getElementById("gasAlarmIndicator");
  
  if (gasAlarmIndicator) {
    gasAlarmIndicator.textContent = "NGUY HIỂM KHÍ GAS! 💨";
    gasAlarmIndicator.classList.add("alert");
  }
  
  // Tự động bật buzzer và bơm
  controlDevice('buzzer', true);
  controlDevice('pump', true);
  isPumpAutoMode = true;
  
  // Cập nhật trạng thái tự động
  const pumpAutoStatus = document.getElementById("pumpAutoStatus");
  if (pumpAutoStatus) {
    pumpAutoStatus.textContent = "TỰ ĐỘNG BẬT (Cảnh báo khí gas)";
    pumpAutoStatus.classList.add("auto-on");
  }
  
  addMessageToHistory("🚨 CẢNH BÁO: Phát hiện khí gas nguy hiểm! Đã tự động bật bơm và còi.");
}

// Hàm tắt cảnh báo khí gas
function deactivateGasAlarm() {
  isGasAlarmActive = false;
  const gasAlarmIndicator = document.getElementById("gasAlarmIndicator");
  
  if (gasAlarmIndicator) {
    gasAlarmIndicator.textContent = "AN TOÀN";
    gasAlarmIndicator.classList.remove("alert");
  }
  
  // Chỉ tắt các thiết bị nếu đang ở chế độ tự động
  if (isPumpAutoMode) {
    controlDevice('pump', false);
    controlDevice('buzzer', false);
    isPumpAutoMode = false;
    
    const pumpAutoStatus = document.getElementById("pumpAutoStatus");
    if (pumpAutoStatus) {
      pumpAutoStatus.textContent = "";
      pumpAutoStatus.classList.remove("auto-on");
    }
  }
  
  addMessageToHistory("Cảnh báo khí gas đã tắt. Môi trường an toàn.");
}

// Hàm cập nhật mức khí gas
function updateGasLevel(gasLevel) {
  currentGasLevel = gasLevel;
  
  const gasElement = document.getElementById("gasLevel");
  if (gasElement) {
    gasElement.textContent = gasLevel;
  }
  
  // Update gas gauge (giả sử range 0-2000)
  updateGauge("gasGauge", gasLevel, 0, 2000);
}

// Hàm cập nhật thông báo nhiệt độ và điều khiển quạt tự động
function updateTemperatureNotification(temperature) {
  const notificationElement = document.getElementById("temperatureNotification");
  if (!notificationElement || isNaN(temperature)) return;

  let message = "";
  let className = "";

  if (temperature < 18) {
    message = "❄️ TRỜI LẠNH\nBò có thể bị lạnh, cần sưởi ấm";
    className = "notification-cold";
  } else if (temperature >= 18 && temperature <= 28) {
    message = "🌤️ TRỜI MÁT MẺ\nMôi trường tốt cho bò phát triển";
    className = "notification-cool";
  } else if (temperature > 28 && temperature <= 35) {
    message = "☀️ TRỜI ẤM\nCần tăng thông gió cho trang trại";
    className = "notification-warm";
  } else if (temperature > 35 && temperature <= 40) {
    message = "🔥 TRỜI NÓNG\nCần làm mát khẩn cấp";
    className = "notification-hot";
  } else if (temperature > 40) {
    message = "🚨 TRỜI QUÁ NÓNG\nCảnh báo! Bò có thể bị sốc nhiệt";
    className = "notification-hot";
  }

  notificationElement.textContent = message;
  
  notificationElement.classList.remove(
    "notification-cold", 
    "notification-cool", 
    "notification-warm", 
    "notification-hot"
  );
  
  notificationElement.classList.add(className);
}

// Hàm điều khiển quạt tự động theo nhiệt độ
function autoControlFan(temperature) {
  if (!mqttClient || !mqttClient.connected) return;

  const fanAutoStatus = document.getElementById("fanAutoStatus");
  
  // Nhiệt độ > 40°C: BẬT quạt
  if (temperature > 40 && !isGasAlarmActive) {
    controlDevice('fan', true);
    isFanAutoMode = true;
    
    if (fanAutoStatus) {
      fanAutoStatus.textContent = "TỰ ĐỘNG BẬT (Nhiệt độ > 40°C)";
      fanAutoStatus.classList.add("auto-on");
    }
    
    addMessageToHistory("Quạt tự động BẬT do nhiệt độ cao: " + temperature.toFixed(1) + "°C");
  } 
  // Nhiệt độ ≤ 40°C: TẮT quạt (chỉ khi không có cảnh báo khí gas)
  else if (temperature <= 40 && !isGasAlarmActive && isFanAutoMode) {
    controlDevice('fan', false);
    isFanAutoMode = false;
    
    if (fanAutoStatus) {
      fanAutoStatus.textContent = "TỰ ĐỘNG TẮT (Nhiệt độ ≤ 40°C)";
      fanAutoStatus.classList.remove("auto-on");
    }
    
    addMessageToHistory("Quạt tự động TẮT do nhiệt độ bình thường: " + temperature.toFixed(1) + "°C");
  }
  
  // Nếu có cảnh báo khí gas, hiển thị trạng thái đặc biệt
  if (isGasAlarmActive && fanAutoStatus) {
    fanAutoStatus.textContent = "TỰ ĐỘNG BẬT (Cảnh báo khí gas)";
    fanAutoStatus.classList.add("auto-on");
  }
}

// Hàm kiểm tra cảnh báo
function testAlarm() {
  if (!mqttClient || !mqttClient.connected) {
    showFeedback("Chưa kết nối MQTT!", true);
    return;
  }

  const alarmIndicator = document.getElementById("alarmIndicator");
  
  // Hiển thị cảnh báo test
  alarmIndicator.textContent = "KIỂM TRA CÒI 🔔";
  alarmIndicator.classList.add("alert");
  
  // Kích hoạt buzzer test
  controlDevice('buzzer', true);
  
  addMessageToHistory("Đang kiểm tra hệ thống còi báo động");
  showFeedback("Đang kiểm tra còi báo động...");
  
  // Tự động tắt sau 3 giây
  setTimeout(() => {
    if (!isAlarmActive && !isGasAlarmActive) {
      alarmIndicator.textContent = "BÌNH THƯỜNG";
      alarmIndicator.classList.remove("alert");
      controlDevice('buzzer', false);
    }
  }, 3000);
}

// Hàm tắt âm thanh cảnh báo
function silenceAlarm() {
  if (!mqttClient || !mqttClient.connected) {
    showFeedback("Chưa kết nối MQTT!", true);
    return;
  }

  // Chỉ tắt buzzer, giữ nguyên trạng thái cảnh báo
  controlDevice('buzzer', false);
  addMessageToHistory("Đã tắt âm thanh cảnh báo");
  showFeedback("Đã tắt âm thanh cảnh báo");
}

// Hàm hiển thị phản hồi
function showFeedback(message, isError = false) {
  const feedback = document.getElementById("controlFeedback");
  if (!feedback) return;
  
  feedback.textContent = message;
  feedback.className = "control-feedback show";
  if (isError) {
    feedback.classList.add("error");
  }
  
  setTimeout(() => {
    feedback.classList.remove("show");
  }, 3000);
}

function initializeCharts() {
  // Temperature Chart
  const tempCtx = document.getElementById("temperatureChart").getContext("2d");
  temperatureChart = new Chart(tempCtx, {
    type: "line",
    data: {
      labels: timeLabels,
      datasets: [
        {
          label: "Nhiệt độ (°C)",
          data: temperatureData,
          borderColor: "#ff6b6b",
          backgroundColor: "rgba(255, 107, 107, 0.1)",
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#ff6b6b",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#1a472a",
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#1a472a",
          },
          grid: {
            color: "rgba(46, 139, 87, 0.1)",
          },
        },
        y: {
          min: 0,
          max: 50,
          ticks: {
            color: "#1a472a",
            callback: function (value) {
              return value + " °C";
            },
          },
          grid: {
            color: "rgba(46, 139, 87, 0.1)",
          },
        },
      },
    },
  });

  // Humidity Chart
  const humCtx = document.getElementById("humidityChart").getContext("2d");
  humidityChart = new Chart(humCtx, {
    type: "line",
    data: {
      labels: timeLabels,
      datasets: [
        {
          label: "Độ ẩm (%)",
          data: humidityData,
          borderColor: "#4fc3f7",
          backgroundColor: "rgba(79, 195, 247, 0.1)",
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#4fc3f7",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#1a472a",
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#1a472a",
          },
          grid: {
            color: "rgba(46, 139, 87, 0.1)",
          },
        },
        y: {
          min: 0,
          max: 100,
          ticks: {
            color: "#1a472a",
            callback: function (value) {
              return value + " %";
            },
          },
          grid: {
            color: "rgba(46, 139, 87, 0.1)",
          },
        },
      },
    },
  });
}

function connectToBroker() {
  const clientId = "client" + Math.random().toString(36).substring(7);
  const host = "wss://broker.emqx.io:8084/mqtt";

  const options = {
    keepalive: 60,
    clientId: clientId,
    protocolId: "MQTT",
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: 1000,
    connectTimeout: 30 * 1000,
  };

  mqttClient = mqtt.connect(host, options);

  mqttClient.on("error", (err) => {
    console.log("Error: ", err);
    updateConnectionStatus(false);
    addMessageToHistory("Lỗi kết nối MQTT: " + err.message);
  });

  mqttClient.on("reconnect", () => {
    console.log("Reconnecting...");
    updateConnectionStatus(false);
  });

  mqttClient.on("connect", () => {
    console.log("Client connected:" + clientId);
    updateConnectionStatus(true);
    addMessageToHistory("Đã kết nối đến máy chủ MQTT thành công");

    // Enable subscribe button after connection
    const subscribeBtn = document.getElementById("subscribeBtn");
    subscribeBtn.disabled = false;
    subscribeBtn.textContent = "Theo dõi";

    // Auto-subscribe to default topic
    setTimeout(() => {
      subscribeToTopic();
    }, 1000);
  });

  mqttClient.on("message", (topic, message, packet) => {
    console.log(
      "Received Message: " + message.toString() + "\nOn topic: " + topic
    );

    try {
      const data = JSON.parse(message.toString());
      console.log("Parsed data:", data);

      if (topic === "device_states") {
        // Đồng bộ trạng thái thiết bị từ ESP32
        if (data.led !== undefined) {
          updateDeviceUI('led', data.led);
        }
        if (data.fan !== undefined) {
          updateDeviceUI('fan', data.fan);
        }
        if (data.pump !== undefined) {
          updateDeviceUI('pump', data.pump);
        }
        if (data.buzzer !== undefined) {
          updateDeviceUI('buzzer', data.buzzer);
        }
      } 
      else if (topic === "PBL3" || topic === document.getElementById("topic").value.trim()) {
        // Xử lý dữ liệu cảm biến
        updateSensorData(data);
        
        // Đồng bộ trạng thái thiết bị từ dữ liệu cảm biến
        if (data.light !== undefined) updateDeviceUI('led', data.light);
        if (data.fan !== undefined) updateDeviceUI('fan', data.fan);
        if (data.pump !== undefined) updateDeviceUI('pump', data.pump);
        if (data.buzzer !== undefined) updateDeviceUI('buzzer', data.buzzer);
        
        addMessageToHistory(`Dữ liệu cảm biến: ${data.temperature}°C, ${data.humidity}%, Gas: ${data.gas_level}`);
      }
      else if (topic === "fire_alarm") {
        const alarmMessage = message.toString();
        if (alarmMessage === "ACTIVE") {
          activateFireAlarm();
        } else if (alarmMessage === "NORMAL") {
          deactivateFireAlarm();
        }
      }
      else if (topic === "gas_alarm") {
        const alarmMessage = message.toString();
        if (alarmMessage === "DANGER") {
          activateGasAlarm();
        } else if (alarmMessage === "NORMAL") {
          deactivateGasAlarm();
        }
      }
    } catch (e) {
      console.log("Error parsing JSON: ", e);
      // Xử lý message không phải JSON
      handleNonJSONMessage(topic, message.toString());
    }
  });
}

// Hàm xử lý message không phải JSON
function handleNonJSONMessage(topic, message) {
  if (topic === "led_control") {
    const state = message === "ON" || message === "1";
    updateDeviceUI('led', state);
  }
  else if (topic === "fan_control") {
    const state = message === "ON" || message === "1";
    updateDeviceUI('fan', state);
  }
  else if (topic === "pump_control") {
    const state = message === "ON" || message === "1";
    updateDeviceUI('pump', state);
  }
  else if (topic === "buzzer_control") {
    const state = message === "ON" || message === "1";
    updateDeviceUI('buzzer', state);
  }
  else if (topic === "fire_alarm") {
    if (message === "ACTIVE") activateFireAlarm();
    else if (message === "NORMAL") deactivateFireAlarm();
  }
  else if (topic === "gas_alarm") {
    if (message === "DANGER") activateGasAlarm();
    else if (message === "NORMAL") deactivateGasAlarm();
  }
}

function updateConnectionStatus(connected) {
  const statusElement = document.getElementById("connectionStatus");
  const indicator = statusElement.querySelector(".status-indicator");
  const text = statusElement.querySelector("span");

  if (connected) {
    indicator.classList.add("connected");
    text.textContent = "ĐÃ KẾT NỐI";
  } else {
    indicator.classList.remove("connected");
    text.textContent = "MẤT KẾT NỐI";
  }
}

function updateSensorData(data) {
  try {
    const now = new Date();
    const timeLabel = now.toLocaleTimeString();

    // Update temperature với dữ liệu thực từ DHT22
    if (data.temperature !== undefined && !isNaN(data.temperature)) {
      const tempElement = document.getElementById("temperature");
      if (tempElement) {
        tempElement.textContent = `${data.temperature.toFixed(1)} °C`;
      }

      // Update temperature notification và điều khiển quạt tự động
      updateTemperatureNotification(data.temperature);
      autoControlFan(data.temperature);

      // Kiểm tra cảnh báo cháy
      checkFireAlarm(data.temperature);

      // Update gauge
      updateGauge("tempGauge", data.temperature, 0, 50);

      // Update chart
      temperatureData.push(data.temperature);
      timeLabels.push(timeLabel);

      if (temperatureData.length > maxDataPoints) {
        temperatureData.shift();
        timeLabels.shift();
      }

      if (temperatureChart) {
        temperatureChart.update();
      }
    }

    // Update humidity với dữ liệu thực từ DHT22
    if (data.humidity !== undefined && !isNaN(data.humidity)) {
      const humElement = document.getElementById("humidity");
      if (humElement) {
        humElement.textContent = `${data.humidity.toFixed(1)} %`;
      }

      // Update gauge
      updateGauge("humGauge", data.humidity, 0, 100);

      // Update chart
      humidityData.push(data.humidity);

      if (humidityData.length > maxDataPoints) {
        humidityData.shift();
      }

      if (humidityChart) {
        humidityChart.update();
      }
    }

    // Update gas level và cảnh báo từ cảm biến MQ
    if (data.gas_level !== undefined && !isNaN(data.gas_level)) {
      updateGasLevel(data.gas_level);
      checkGasAlarm(data.gas_level);
    }

    // Thêm log để debug
    console.log(`DHT22 Data - Temp: ${data.temperature}°C, Hum: ${data.humidity}% | MQ Gas: ${data.gas_level}`);

  } catch (error) {
    console.error("Error updating sensor data:", error);
  }
}

function updateGauge(gaugeId, value, min, max) {
  try {
    const gauge = document.getElementById(gaugeId);
    if (!gauge || isNaN(value)) return;

    const percentage = Math.max(
      0,
      Math.min(100, ((value - min) / (max - min)) * 100)
    );
    const degrees = (percentage / 100) * 360;

    gauge.style.background = `conic-gradient(from 0deg, #4CAF50 0deg, #4CAF50 ${degrees}deg, #e0e0e0 ${degrees}deg)`;
  } catch (error) {
    console.error("Error updating gauge:", error);
  }
}

function subscribeToTopic() {
  // Kiểm tra MQTT client đã kết nối chưa
  if (!mqttClient || !mqttClient.connected) {
    showFeedback("Chưa kết nối MQTT! Vui lòng chờ kết nối.", true);
    return;
  }

  const topic = document.getElementById("topic").value.trim();
  if (!topic) {
    showFeedback("Vui lòng nhập topic trước!", true);
    return;
  }

  try {
    console.log(`Subscribing to Topic: ${topic}`);
    mqttClient.subscribe(topic, { qos: 0 });

    // Also subscribe to device control topics
    mqttClient.subscribe("led_control", { qos: 0 });
    mqttClient.subscribe("fan_control", { qos: 0 });
    mqttClient.subscribe("pump_control", { qos: 0 });
    mqttClient.subscribe("buzzer_control", { qos: 0 });
    mqttClient.subscribe("fire_alarm", { qos: 0 });
    mqttClient.subscribe("gas_alarm", { qos: 0 });
    mqttClient.subscribe("device_status", { qos: 0 });
    mqttClient.subscribe("device_states", { qos: 0 }); // Subscribe topic trạng thái thiết bị

    addMessageToHistory(
      `Đã theo dõi topic: ${topic} để nhận dữ liệu từ cảm biến DHT22 và MQ`
    );
    showFeedback(`Đã theo dõi topic: ${topic}`);
  } catch (error) {
    console.error("Error subscribing to topic:", error);
    showFeedback("Lỗi khi theo dõi topic. Vui lòng thử lại.", true);
  }
}

function unsubscribeToTopic() {
  const topic = document.getElementById("topic").value.trim();
  if (!topic) {
    showFeedback("Vui lòng nhập topic trước!", true);
    return;
  }

  console.log(`Unsubscribing from Topic: ${topic}`);
  mqttClient.unsubscribe(topic, { qos: 0 });
  addMessageToHistory(`Đã dừng theo dõi topic: ${topic}`);
  showFeedback(`Đã dừng theo dõi topic: ${topic}`);
}

function addMessageToHistory(message) {
  try {
    const historyContainer = document.getElementById("messageHistory");
    if (!historyContainer) return;

    const now = new Date();
    const timestamp = now.toLocaleTimeString() + " " + now.toLocaleDateString();

    // Truncate long messages to prevent layout breaking
    const truncatedMessage =
      message.length > 100 ? message.substring(0, 100) + "..." : message;

    const messageItem = document.createElement("div");
    messageItem.className = "message-item";
    messageItem.innerHTML = `
      <span class="timestamp">${timestamp}</span>
      <span class="message" title="${message}">${truncatedMessage}</span>
    `;

    // Add to top of history
    historyContainer.insertBefore(messageItem, historyContainer.firstChild);

    // Keep only last 30 messages to prevent UI lag
    while (historyContainer.children.length > 30) {
      historyContainer.removeChild(historyContainer.lastChild);
    }

    // Auto-scroll to top
    historyContainer.scrollTop = 0;
  } catch (error) {
    console.error("Error adding message to history:", error);
  }
}

// Initialize with some sample data
function initializeSampleData() {
  try {
    const now = new Date();
    const timeLabel = now.toLocaleTimeString();

    // Add initial data points
    temperatureData.push(0);
    humidityData.push(0);
    timeLabels.push(timeLabel);

    // Update charts safely
    if (temperatureChart) {
      temperatureChart.update();
    }
    if (humidityChart) {
      humidityChart.update();
    }
  } catch (error) {
    console.error("Error initializing sample data:", error);
  }
}

// Call initialization with delay to ensure DOM is ready
setTimeout(initializeSampleData, 2000);