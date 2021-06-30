require('log-timestamp');

const environment = process.env.NODE_ENV || 'development';
const config = {...(require('../config.default.json'))[environment], ...(require('../config.json'))[environment]};

const BlueLinky = require('bluelinky');

var Divoom = require('node-divoom-timebox-evo');
const TIMEBOX_ADDRESS = config['timebox_address'];

var btSerial = new(require('bluetooth-serial-port')).BluetoothSerialPort();

var isConnected = false;
var numRequests = 1;

const INTERVAL_OFF_DAY = 15 * 60 * 1000;
const INTERVAL_OFF_NIGHT = 30 * 60 * 1000;
const INTERVAL_ON = 5 * 60 * 1000;
const INTERVAL_CHARGING = 2 * 60 * 1000;

var interval = INTERVAL_OFF_DAY;

function btConnect() {
    console.log('Connecting to ' + TIMEBOX_ADDRESS);
    btSerial.findSerialPortChannel(TIMEBOX_ADDRESS, function(channel) {
        btSerial.connect(TIMEBOX_ADDRESS, channel, function() {
            isConnected = true;
            console.log('OK: connected to Divoom');

            btSerial.on('data', function(buffer) {
                console.log('Divoom: ');
                console.log(buffer.toString('ascii'));
            });

            btSerial.on('closed', function() {
                console.log('Divoom disconnected');
                isConnected = false;
            });
        }, function() {
            console.log('Error: cannot connect to Divoom');
        });
    }, function() {
        console.log('Error: Divoom found nothing');
    });

}


function btSend(msg) {
    //  console.log(msg);

    btSerial.write(msg,
        function(err, bytesWritten) {
            if (err) console.log(err);
        }
    );
}

function Sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function printSoC(soc) {

    if (!isConnected) {
        btConnect();

        await Sleep(10 * 1000);
    }

    var d = (new Divoom.TimeboxEvo()).createRequest('text', {
        text: soc + '%'
    });
    d.paletteFn = d.PALETTE_BLACK_ON_CMY_RAINBOW; // Baked in color palette, but you can define your own
    d.animFn = d.ANIM_HORIZONTAL_GRADIANT_BACKGROUND; // Baked in animation, but you can define your own

    // This contains what is required to bootstrap the display on the Timebox
    d.messages.asBinaryBuffer().forEach(elt => {
        btSend(elt);
    });

    // Then you have to send your animation frame by frame, I suggest that you do no go over 30 message per second, if you do, the timebox will disconnect.
    // This would generate 512 animation frames.
    for (i = 0; i < 512; i++) {
        d.getNextAnimationFrame().asBinaryBuffer().forEach(elt => {
            btSend(elt);
        });
    }

}

function doRequest() {
    console.log('Requesting...(' + (numRequests++) + ')...');

    const client = new BlueLinky({
        username: config['username'],
        password: config['password'],
        brand: config['brand'],
        region: config['region'],
        pin: config['pin']
    });

    client.on('ready', async () => {
        const vehicle = client.getVehicle(config['vin']);
        try {
            const response = await vehicle.status();
            console.log(response);

            h = (new Date()).getHours();
            if (h >= config['night_hour_end'] && h <= config['night_hour_start']) {
                interval = INTERVAL_OFF_DAY;
            } else {
                interval = INTERVAL_OFF_NIGHT;
            }
            if (response.engine) {
                interval = INTERVAL_ON;
                console.log('Engine is ON');
            } else {
                console.log('Engine is OFF');
            }
            if (response.evStatus && response.evStatus.batteryCharge) {
                interval = INTERVAL_CHARGING;
                console.log('Battery is CHARGING');
            } else {
                console.log('Battery is NOT CHARGING');
            }
            console.log('New interval ' + interval);

            if (response.evStatus && response.evStatus.batteryStatus) {
                console.log('SoC is ' + response.evStatus.batteryStatus);
                printSoC(response.evStatus.batteryStatus);
            } else {
                console.log('Error ');
                console.log(response);
            }
        } catch (err) {
            // log the error from the command invocation 
            console.log('Error ');
            console.log(err);
        }
    });

    client.on('error', async (err) => {
        // something went wrong with login
        console.log('Error ');
        console.log(err);
        interval = 2 * interval;
        if (interval > 60 * 60 * 1000) interval = 60 * 60 * 1000;
        console.log('New interval ' + interval);
    });

    setTimeout(doRequest, interval);
}

doRequest();
