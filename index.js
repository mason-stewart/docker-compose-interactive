#! /usr/bin/env node

var inquirer = require("inquirer"),
    yaml = require("yamljs"),
    _ = require("lodash"),
    colors = require("colors/safe"),
    shell = require("shelljs"),
    spawn = require('child_process').spawn,
    keypress = require('keypress');

var config = yaml.load('docker-compose.yml');
var keys = _.chain(config).keys().value();
var log_colors = ['red', 'green', 'blue', 'yellow', 'cyan', 'magenta'];
var border =  "\n" + _.repeat("=", process.stdout.columns) + "\n";

var ui = new inquirer.ui.BottomBar();
var verb,
    logProcesses = [],
    colorPairings = {};


inquirer.prompt([
  {
    type: "list",
    name: "start",
    message: function(){
      return "Cool, we found a docker-compose.yml file with these containers:\n\n" +
             colors.green(keys.join(' \n')) +
             "\n\n What should we do?";
    },
    choices: [{name: "Turn them all on!", value: "all"},
              {name: "Choose which ones to start...", value: "choose"}]
  }

], function( answers ) {

  ui.updateBottomBar(mainMenu());
  
  if (answers.start === "all") {
    logProcesses = _.chain(keys).map(function(container, index){
      
      // store a consistent color for this container
      colorPairings[container] = log_colors[index]
      
      ui.log.write("Spinning up " + colors.green(container) + "...")

      // docker-compose start will finish almost immediately and produce no logs,
      // so shell.exec is just fine.
      shell.exec('docker-compose start ' + container, {silent: true});
      
      // return an object of with a ref the long-running log process and an array of listeners
      return spawnLogProcess(container)
    }).object().value();

    // make `process.stdin` begin emitting "keypress" events
    keypress(process.stdin);

    // listen for the "keypress" event
    process.stdin.on('keypress', mainMenuCallback);

    process.stdin.setRawMode(true);
    process.stdin.resume();

  }
});

function mainMenuCallback(ch, key) {
  if ((key && key.ctrl && key.name == 'c') || (key && key.name == 'q')) {
    process.exit();
  }
  if (key && key.name == 'p') {
    unbindNumberpadListeners()
    ui.updateBottomBar(dockerPSMenu() + backMenu());
  }
  if (key && key.name == 'r') {
    unbindNumberpadListeners()
    ui.updateBottomBar(containerMenu('restart'));
  }
  if (key && key.name == 's') {
    unbindNumberpadListeners()
    ui.updateBottomBar(containerMenu('stop'));
  }
  if (key && key.name == 't') {
    unbindNumberpadListeners()
    ui.updateBottomBar(containerMenu('start'));
  }
  if (key && key.name == 'l') {
    unbindNumberpadListeners()
    ui.updateBottomBar(containerMenu('build'));
  }
  if (key && key.name == 'm') {
    unbindNumberpadListeners()
    ui.updateBottomBar(containerMenu('rm -f'));
  }
  if (key && key.name == 'k') {
    unbindNumberpadListeners()
    ui.updateBottomBar(containerMenu('kill'));
  }
  if (key && key.name == 'b') {
    unbindNumberpadListeners()
    ui.updateBottomBar(mainMenu());
  }
}


function numpadCallback (ch, key) {
  if (ch && ch.match(/[0-9]/)) {
    var container = keys[ch];
    ui.log.write(colors.white("docker_compose_interactive | Attempting to execute docker-compose " + verb + " " + container));
    stopAndUnbindLogProcess(logProcesses[container]);
    shell.exec("docker-compose " + verb + " " + container,function(code,output){
      ui.log.write(output);
      ui.log.write(code);
      if ((verb === "start" || verb === "restart") && code == 0) {
        spawnLogProcess(container)
      }
    });

  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
}

function mainMenu () {
  return colors.white(
    border +
    "Commands:\n" +
    colors.cyan("(") + colors.magenta("r") + colors.cyan(")") + "estart container, " + 
    colors.cyan("(") + colors.magenta("s") + colors.cyan(")") + "top container, " +
    "s" + colors.cyan("(") + colors.magenta("t") + colors.cyan(")") + "tart container, " +
      colors.cyan("(") + colors.magenta("p") + colors.cyan(")") + "rocess list, " +
      "bui" + colors.cyan("(") + colors.magenta("l") + colors.cyan(")") + "d container, " +
      "re" + colors.cyan("(") + colors.magenta("m") + colors.cyan(")") + "ove container, " +
      colors.cyan("(") + colors.magenta("k") + colors.cyan(")") + "ill container, " +

    colors.cyan("(") + colors.magenta("q") + colors.cyan(")") + "uit" +
    "\n"
  )
}

function backMenu () {
  return colors.white(
    border +
      "Commands: " +
      colors.cyan("(") + colors.magenta("b") + colors.cyan(")") + "ack to main menu" + 
      "\n"
  )
}

function unbindNumberpadListeners(){
  process.stdin.removeListener("keypress", numpadCallback);
}

function containerMenu (verbArg) {
  verb = verbArg;
  process.stdin.on("keypress", numpadCallback)
  
  var choices = _.map(keys, function(key,index){
    return colors.cyan("(") + colors.magenta(index) + colors.cyan(")") + key 
  }).join(', ')
  
  return colors.white(
    border +
    "Which container do you want to " + verb +  "?\n" + choices + ", " + 
    colors.cyan("(") + colors.magenta("b") + colors.cyan(")") + "ack to main menu" +
    "\n"
  )
}

function dockerPSMenu () {
  // `docker ps` output is way too long (like 180+ chars), so lets slice out the IMAGE and CREATED columns
  var lines = _.map(shell.exec("docker ps", {silent:true}).output.split('\n'), function(line){
    return line.slice(0,20) + line.slice(56,79) + line.slice(99) 
  }).join('\n');
  
  return colors.white(
    border +
    colors.magenta(lines)
  )
}


function spawnLogProcess(container){
  var color = colorPairings[container];
  var logProcess = spawn('docker', ['logs', '-f', 'learn_' + container + '_1']);

  logProcess.stdout.on('data', writeDataToLog.bind({color: color, container: container}))
  logProcess.stderr.on('data', writeDataToLog.bind({color: color, container: container}))
  logProcess.on('close', writeExitCodeToLog.bind({color: color, container: container}))
  
  return [container, logProcess]
}

function stopAndUnbindLogProcess(process){
  process.stdout.removeListener("data", writeDataToLog);
  process.stderr.removeListener("data", writeDataToLog);
  process.removeListener       ("close", writeExitCodeToLog);
  process.kill();
}

function writeDataToLog(data) {
  ui.log.write(colors[this.color](this.container + ' | ') + data);
}

function writeExitCodeToLog(code) {
  ui.log.write(colors[this.color](this.container + ' | exited with code ') + code);
}


// bind resize event to redraw horizontal borders (doesn't work on my OSX?)
process.stdout.on('resize', function() {
  ui.log.write('screen size has changed!');
  border = "\n" + _.repeat("=", process.stdout.columns) + "\n";
  ui.updateBottomBar(border + colors.green("OMG SWAG") + " press " + colors.magenta("ctrl-m") + " to open the menu!" + border);
});
