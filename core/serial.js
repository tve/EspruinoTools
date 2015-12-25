(function() {

  // List of ports and the devices they map to
  var portToDevice = undefined;
  var currentDevice = undefined;

  // called when data received
  var readListener = undefined;

  // For throttled write
  var slowWrite = true;
  var writeData = undefined;
  var writeTimeout = undefined;


  function init() {
    Espruino.Core.Config.add("BAUD_RATE", {
      section : "Communications",
      name : "Baud Rate",
      description : "When connecting over serial, this is the baud rate that is used. 9600 is the default for Espruino",
      type : {9600:9600,14400:14400,19200:19200,28800:28800,38400:38400,57600:57600,115200:115200},
      defaultValue : 9600,
    });

    var devices = Espruino.Core.Serial.devices;
    for (var i=0;i<devices.length;i++)
      if (devices[i].init)
        devices[i].init();
  }

  var startListening=function(callback) {
    var oldListener = readListener;
    readListener = callback;
    return oldListener;
  };

  var getPorts=function(callback) {
    var ports = [];
    portToDevice = [];
    // get all devices
    var responses = 0;
    var devices = Espruino.Core.Serial.devices;
    if (!devices || devices.length==0) {
      return callback(ports);
    }
    devices.forEach(function (device) {
      device.getPorts(function(devicePorts) {
        if (devicePorts) {
          devicePorts.forEach(function(port) {
            ports.push(port);
            portToDevice[port] = device;
          });
        }
        responses++;
        if (responses == devices.length)
          callback(ports);
      });
    });
  };

  var openSerial=function(serialPort, connectCallback, disconnectCallback) {
    /* If openSerial is called, we need to have called getPorts first
      in order to figure out which one of the serial_ implementations
      we must call into. */
    if (portToDevice === undefined) {
      portToDevice = []; // stop recursive calls if something errors
      return getPorts(function() {
        openSerial(serialPort, connectCallback, disconnectCallback);
      });
    }

    if (!(serialPort in portToDevice)) {
      console.error("Port "+JSON.stringify(serialPort)+" not found");
      return connectCallback(undefined);
    }
    currentDevice = portToDevice[serialPort];
    currentDevice.open(serialPort, function(cInfo) {
      // CONNECT
      if (!cInfo) {
//        Espruino.Core.Notifications.error("Unable to connect");
        console.error("Unable to open device (connectionInfo="+cInfo+")");
        connectCallback(undefined);
      } else {
        connectionInfo = cInfo;
        connectedPort = serialPort;
        console.log("Connected", cInfo);
        Espruino.callProcessor("connected", undefined, function() {
          connectCallback(cInfo);
        });
      }
    }, function(data) {
      // RECEIEVE DATA
      if (!(data instanceof ArrayBuffer)) console.warn("Serial port implementation is not returning ArrayBuffers");
      if (readListener) readListener(data);
    }, function() {
      // DISCONNECT
      currentDevice = undefined;
      if (writeTimeout!==undefined)
        clearTimeout(writeTimeout);
      writeTimeout = undefined;
      writeData = undefined;

      Espruino.callProcessor("disconnected", undefined, function() {
        disconnectCallback();
      });
    });
  };

  var str2ab=function(str) {
    var buf=new ArrayBuffer(str.length);
    var bufView=new Uint8Array(buf);
    for (var i=0; i<str.length; i++) {
      var ch = str.charCodeAt(i);
      if (ch>=256) {
        console.warn("Attempted to send non-8 bit character - code "+ch);
        ch = "?".charCodeAt(0);
      }
      bufView[i] = ch;
    }
    return buf;
  };

  var closeSerial=function() {
    if (currentDevice)
      currentDevice.close();
    else
      console.error("Close called, but serial port not open");
  };

  var isConnected = function() {
    return currentDevice!==undefined;
  };

  // Throttled serial write
  var writeSerial = function(data, showStatus) {
    if (!isConnected()) return; // throw data away
    if (showStatus===undefined) showStatus=true;

    // Queue our data to write
    var wasSending = false;
    if (writeData == undefined) {
      writeData = data;
    } else {
      writeData += data;
      wasSending = true;
    }

    /* if we're throttling our writes we want to send small
     * blocks of data at once */
    var blockSize = slowWrite ? 15 : 512;

    showStatus &= writeData.length>blockSize;
    if (showStatus) {
      Espruino.Core.Status.setStatus("Sending...", writeData.length);
      console.log("---> "+JSON.stringify(data));
    }

    function sender() {
      writeTimeout = undefined; // we've been called

      if (writeData!==undefined) {
        var d = undefined;
        if (writeData.length>blockSize) {
          d = writeData.substr(0,blockSize);
          writeData = writeData.substr(blockSize);
        } else {
          d = writeData;
          writeData = undefined;
        }
        // update status
        if (showStatus)
          Espruino.Core.Status.incrementProgress(d.length);
        // actually write data
        currentDevice.write(d, function() {
          // now written...
          if (writeData!==undefined) {
            writeTimeout = setTimeout(sender, 50);
          } else {
            if (showStatus)
              Espruino.Core.Status.setStatus("Sent");
          }
        });
      }
    }

    if (!wasSending) {
      sender(); // start sending instantly
    }
  };

  // ----------------------------------------------------------
  Espruino.Core.Serial = {
    "devices" : [], // List of devices that can provide a serial API
    "init" : init,
    "getPorts": getPorts,
    "open": openSerial,
    "isConnected": isConnected,
    "startListening": startListening,
    "write": writeSerial,
    "close": closeSerial,
    "isSlowWrite": function() { return slowWrite; },
    "setSlowWrite": function(isOn, force) {
      if ((!force) && Espruino.Config.SERIAL_THROTTLE_SEND) {
        console.log("ForceThrottle option is set - set Slow Write = true");
        isOn = true;
      } else
        console.log("Set Slow Write = "+isOn);
      slowWrite = isOn;
    },
  };
})();
