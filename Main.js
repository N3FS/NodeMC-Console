/* 
 * This is NodeMC-Console, a client which connects to NodeMC-CORE
 * and behaves like a dashboard. Only compatible with The Jonsey
 * Server fork of NodeMC.
 */ 

var request = require("request");
var socketio = require("socket.io-client");
var settings = require("./settings.json");
var vorpal = require("vorpal")();
var io;

var nmcserver;
var nmcport;
var nmcapikey;
var nmcaddress;
var nmcstatus;
var authenticated = false;

if (settings.address === null || settings.apikey === null || settings.port === null || settings.token === null || settings.authmode === null) {
    settings.address = "your.nodemc.instance/here";
    settings.apikey = "if using authmode: 'apikey', set the API key here";
    settings.token = "if using authmode: 'totp', generate a token and set it here";
    settings.authmode = "apikey";
    settings.port = 3000;
    vorpal.log("You didn't enter the settings correctly. Enter the NodeMC address and authentication keys in settings.json.");
    process.exit(1);
} else {
    nmcserver = settings.address;
    nmcport = settings.port;
    nmcauthmode = settings.authmode;
    if (nmcauthmode == "totp") {
        nmcapikey = settings.token;
    } else if (nmcauthmode == "apikey") {
        nmcapikey = settings.apikey;
    }
    nmcaddress = "http://" + nmcserver + ":" + nmcport + "/";
}

vorpal.log("Connecting to NodeMC at " + nmcserver);

// ----- Socket.IO -----

io = socketio.connect(nmcserver, {port: nmcport});

// Listeners

io.on("connect", function () {
    vorpal.log("Connected successfully.");
    auth(nmcapikey, nmcauthmode);
});

io.on("connect_error", function (e) {
    vorpal.log(e);
    vorpal.log("Failed to connect.");
    process.exit(1);
});

io.on("disconnect", function (n) {
    vorpal.log("Disconnected from server.");
    authenticated = false;
});

io.on("reconnect", function (n) {
    vorpal.log("Reconnected successfully after " + n + " attempts.");
    auth(nmcapikey, "apikey");
});

io.on("reconnect_attempt", function () {
    vorpal.log("Attempting to reconnect.");
});

io.on("reconnect_error", function () {
    vorpal.log("Failed to reconnect.");
});

io.on("reconnect_failed", function (n) {
    vorpal.log("Could not reconnect after " + n + " attempts.");
    process.exit(1);
});

io.on("authstatus", function (status) {
    switch(status) {
        case "deauth success":
            vorpal.log("Successfully deauthenticated.");
            authenticated = false;
            break;
        case "deauth failed":
            vorpal.log("Failed to deauthenticate (whut)");
            break;
        case "auth success":
            vorpal.log("Successfully authenticated.");
            authenticated = true;
            break;
        case "auth failed":
            vorpal.log("Failed to authenticate. Invalid API key or server does not support API keys.");
            authenticated = false;
            break;
        case "authed":
            authenticated = true;
            break;
        case "not authed":
            authenticated = false;
            break;
    }
});

io.on("status", function (status) {
    nmcstatus = {status: status, lastChecked: Date()};
});

io.on("appendlog", function (data) {
    vorpal.log(data.trim());
});

// Emitters

function auth(authkey, type) {
    if (type == "apikey" || type === null) {
        io.emit("auth", {action: "auth", key: authkey});
    } else if (type == "totp") {
        io.emit("auth", {action: "auth", key: token});
    }
}

function updateStatus() {
    io.emit("status");
}

function updateAuthStatus() {
    io.emit("auth", {action: "status"});
}

// ----- HTTP POST and GET methods -----

// GET

function getFullLog(callback) {
    request({uri: "/log", baseUrl: nmcaddress}, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            callback(body);
        } else {
            vorpal.log(error);
            callback("Error getting full log!");
        }
    });
}

function getInfo(callback) {
    request({uri: "/info", baseUrl: nmcaddress}, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            if (body.substring(0, 37) == "ReferenceError: srvprp is not defined") {
                callback({error: "The NodeMC instance does not support getting server info!"});
            } else {
                var props = {};
                props.motd = body[0];
                props.port = body[1];
                props.whitelist = body[2];
                props.version = body[3];
                props.ip = body[4];
                props.id = body[5];
                vorpal.log(JSON.stringify(props));
                callback(props);
            }
        } else {
            vorpal.log(error);
            callback({error: "There was an error getting the server info."});
        }
    });
}

// POST

function sendCommand(command, callback) {
    if (authenticated === false) {
        vorpal.log("You are not currently authenticated.");
    }
    
    var data = {command: command, key: nmcapikey};
    request({uri: "/command", baseUrl: nmcaddress, method: "POST", body: data, json: true}, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            if (body == "Invalid API key") {
                authenticated = false;
                callback(false);
            } else {
                callback(true);
            }
        } else {
            vorpal.log(error);
            callback(false);
        }
    });
}

// ----- Vorpal -----

// Commands

vorpal
    .command("auth [authkey]")
    .description("Authenticate with the server using an API key or unique token.")
    .action(function(args, callback) {
        if (authenticated === true) {
            this.log("You are already authenticated!");
        } else {
            auth(args.apikey, "apikey");
        }
        callback();
    });

vorpal
    .command("status")
    .option("-f, --forcecheck", "Force a recheck of the server status.")
    .description("Check the status of the server.")
    .action(function (args, callback) {
        function logStatus() {
            if (typeof nmcstatus == "object") {
                if (typeof nmcstatus.status == "string" && nmcstatus.lastChecked instanceof Date) {
                    vorpal.log("The server is currently " + nmcstatus.status + ".");
                    vorpal.log("Last checked at " + nmcstatus.lastChecked.toUTCString());
                } else {
                    vorpal.log("Failed to check server status. (Invalid status data.)");
                }
            } else {
                vorpal.log("Failed to check server status. (Status not retrieved.)");
            }
        }
        if (args.options.forcecheck || typeof nmcstatus !== "object") {
            updateStatus();
            setTimeout(logStatus, 10000);
        } else {
            logStatus();
        }
        callback();
    });

vorpal
    .command("authstatus")
    .option("-f, --force-check", "Force a recheck of the authentication status.")
    .description("Check whether you are authenticated or not.")
    .action(function (args, callback) {
        if (authenticated !== null || !args.options.force-check) {
            if (authenticated) {
                this.log("You are currently authenticated.");
            } else {
                this.log("You are not currently authenticated.");
            }
        } else {
            updateAuthStatus();
            setTimeout(function () {
                if (authenticated) {
                 this.log("You are currently authenticated.");
                } else {
                    this.log("You are not currently authenticated.");
                }
            }, 10000);
        }
        callback();
    });

vorpal
    .command("command [command...]")
    .description("Send a command to the server.")
    .alias("cmd", ">")
    .action(function (args, callback) {
        if (authenticated) {
            sendCommand(args.command.join(" "), function (success) {
                if (success) {
                    vorpal.log("Successfully ran command '" + args.command.join(" ") + "'.");
                } else {
                    vorpal.log("Failed to run command '" + args.command.join(" ") + "'.");
                }
            });
        } else {
            this.log("You are not currently authenticated.");
        }
        callback();
    });

vorpal
    .command("getlog")
    .description("Gets the last 200 lines of the log.")
    .alias("log")
    .action(function (args, callback) {
        if (authenticated) {
            getFullLog(function (fulllog) {
                vorpal.log(fulllog.split("\n").slice(-200).join("\n"));
            });
        } else {
            this.log("You are not currently authenticated.");
        }
        callback();
    });

vorpal
    .command("info")
    .description("Gets the Minecraft server info.")
    .action(function (args, callback) {
        if (authenticated) {
            getInfo(function (info) {
                if (info.error) {
                    vorpal.log("Error: " + info.error);
                } else {
                    var whitelist;
                    vorpal.log("Version: " + info.version);
                    vorpal.log("Minecraft IP: " + info.ip);
                    vorpal.log("Message of the Day: " + info.motd);
                    vorpal.log("Minecraft Port: " + info.port);
                    if (info.whitelist) {
                        whitelist = "Enabled";
                    } else {
                        whitelist = "Disabled";
                    }
                    vorpal.log("Whitelist: " + whitelist);
                }
            });
        } else {
            this.log("You are not currently authenticated.");
        }
        callback();
    });

// ----- Final initialisation ----- 

// Status checks

setInterval(updateStatus, 60000);
setInterval(updateAuthStatus, 60000);
updateStatus();
updateAuthStatus();

// Output log

setTimeout(function() {
    vorpal.exec("log");
}, 500);

vorpal.delimiter("NodeMC@" + nmcserver + ">").show();
