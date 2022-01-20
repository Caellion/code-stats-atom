'use babel';

const http = require('http');
const https = require('https');

import {Pulse} from './models.js';
import getISOTimestamp from './utils.js';

import PACKAGE_JSON from '../package.json';
const PACKAGE_VERSION = PACKAGE_JSON.version;

// Amount of milliseconds to wait after typing before sending update
const UPDATE_DELAY = 10000;

// Interval between sending multiple old pulses
const MULTIPLE_UPDATE_INTERVAL = 10000;

// Set on activation
let API_KEY = null;
let UPDATE_URL = null;

// Disposables set by the plugin, to be disposed of when it deactivates
//let did_match_binding = null;
//let did_partially_match_bindings = null;
let did_fail_to_match_binding = null;
let did_change_api_key = null;
let did_change_api_url = null;

let old_pulses = [];
let current_pulse = null;
let update_timeout = null;
let update_promise = null;
let update_waiting = false;
let status_bar_tile = null;

function updateStatusBar(text = null) {
  let status_text = 'C::S';

  if (text !== null) {
    status_text += ` ${text}`;
  }

  if (status_bar_tile !== null) {
    status_bar_tile.item.textContent = status_text;
  }
}

// Convert grammar to language name
function convertGrammar(grammar) {
  const name = grammar.name;

  if (name === 'Null Grammar') {
    return 'Plain text';
  }
  else {
    return name;
  }
}

function startUpdate() {
  // Don't do anything if API key or URL is not specified
  if (API_KEY === null || API_KEY === '' || UPDATE_URL === null || UPDATE_URL === '') return;

  // If an update is already in progress, schedule this call right
  // after it -- except if one startUpdate call is already waiting
  if (update_promise !== null && !update_waiting) {
    update_waiting = true;
    update_promise.then(() => {
      update_waiting = false;
      startUpdate();
    });
  }
  else {
    // If there is a current pulse, se its timestamp and move it to the old_pulses
    // list where it will be pushed from
    if (current_pulse !== null) {
      current_pulse.coded_at = new Date();
      old_pulses.push(current_pulse);
      current_pulse = null;
    }

    // If there are no old pulses to update, stop
    if (old_pulses.length === 0) {
      return;
    }

    const update_pulse = old_pulses.shift();
    const xps = Array.from(update_pulse.xps).reduce((acc, val) => {
      acc.push({
        language: convertGrammar(val[0]),
        xp: val[1]
      });
      return acc;
    }, []);

    const data = {
      coded_at: getISOTimestamp(update_pulse.coded_at),
      xps: xps
    };

    update_promise = new Promise((resolve, reject) => {
      //updateStatusBar('…');

      const url = new URL(UPDATE_URL);

      // NOTE: Here we need to use the Node.js http module because it is the only one able to change the user-agent
      // header of the request. This is because Chromium does not allow changing user-agent header, see bug:
      // https://bugs.chromium.org/p/chromium/issues/detail?id=571722
      // By using Node.js we sidestep Chromium entirely. Sadly the API is not so nice, as you can see.
      // NOTE 2: These requests won't appear in the Atom inspector, because they are sent from Node.js.

      // Node.js has separate APIs for HTTPS and HTTP! Makes sense?
      const executor = url.protocol === 'https:'? https : http;
      var JSONData=JSON.stringify(data);

      const req = executor.request({
        method: 'POST',
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        protocol: url.protocol,
        headers: {
          'X-API-Token': API_KEY,
          'Content-Type': 'application/json',
          'User-Agent': `code-stats-atom/${PACKAGE_VERSION}`,
          'Content-Length': JSONData.length
        }
      });

      req.on('response', response => {
        if (response.statusCode !== 201) {
          console.log('code-stats-atom update failed:', response);
          updateStatusBar(`ERR ${response.statusCode}!`);
          resolve();
        }
        else {
            total_xps= 0;
            if (old_pulses.length > 0)
            {
                var index;
                for (index = 0; index < old_pulses.length; ++index) {
                    for (let pair of old_pulses[index].xps)
                    {
                        total_xps += parseInt(pair[1]);
                    }
                }
            }
            if (current_pulse != null)
            {
                for (let pair of current_pulse.xps)
                {
                    total_xps += parseInt(pair[1]);
                }
            }
            // console.log(old_pulses);
            // console.log(current_pulse);
            updateStatusBar(total_xps);
          resolve();
        }
      });

      const handleError = () => {
        updateStatusBar('X_X');
        resolve();
      };

      req.on('timeout', () => handleError());

      req.write(JSONData);
      req.end();
    })
    // Remove promise when handled
    .then(() => update_promise = null);

    // If there are old pulses not sent, send them after a delay
    setTimeout(startUpdate, MULTIPLE_UPDATE_INTERVAL);
  }
}

function getOrCreatePulse() {
  if (current_pulse !== null) {
    return current_pulse;
  }
  else {
    current_pulse = new Pulse(new Date());
    return current_pulse;
  }
}

function addXP(language, xp) {
  let pulse = getOrCreatePulse();
  pulse.addXP(language, xp);
}

function changeEvent(e) {
  // Only count keydown events
  if (e.eventType !== 'keyup') {
    return;
  }

  // Remove hat added by keyup
  const keystrokes = e.keystrokes.substr(1);

  // Only accept certain characters
  if (
    // Normal chars
    keystrokes.length === 1
    // CAPS
    || (keystrokes.startsWith('shift-') && keystrokes.length === 7)
    // Some other approved chars
    || keystrokes === 'space'
    || keystrokes === 'backspace'
    || keystrokes === 'enter'
    || keystrokes === 'tab'
    || keystrokes === 'delete'
  ) {
    const editor = atom.workspace.getActiveTextEditor();

    // In some situations, such as "Replace all", the editor is undefined. If that is the case,
    // abort
    if (editor == null) {
      return;
    }

    const grammar = editor.getGrammar();

    addXP(grammar, 1);

    // When typing, don't send updates until the typing has really stopped. This lessens load
    // on the server considerably.
    if (update_timeout !== null) {
      clearTimeout(update_timeout);
    }
    total_xps= 0;
    if (old_pulses.length > 0)
    {
        var index;
        for (index = 0; index < old_pulses.length; ++index) {
            for (let pair of old_pulses[index].xps)
            {
                total_xps += parseInt(pair[1]);
            }
        }
    }
    if (current_pulse != null)
    {
        for (let pair of current_pulse.xps)
        {
            total_xps += parseInt(pair[1]);
        }
    }
    console.log(old_pulses);
    console.log(current_pulse);
    updateStatusBar(total_xps);
    update_timeout = setTimeout(startUpdate, UPDATE_DELAY);
  }
}

class CodeStatsAtom {
  constructor() {
  }

  activate(state) {
    API_KEY = atom.config.get('code-stats-atom.apiKey');
    UPDATE_URL = atom.config.get('code-stats-atom.apiUrl');
    console.log('code-stats-atom', PACKAGE_VERSION, 'initting with settings:', API_KEY, UPDATE_URL);

    did_change_api_key = atom.config.onDidChange('code-stats-atom.apiKey', {}, (e) => {
      API_KEY = e.newValue;
      console.log('code-stats-atom API key changed to:', API_KEY);
    });

    did_change_api_url = atom.config.onDidChange('code-stats-atom.apiUrl', {}, (e) => {
      UPDATE_URL = e.newValue;
      console.log('code-stats-atom API URL changed to:', UPDATE_URL);
    });

    //did_match_binding = atom.keymaps.onDidMatchBinding(changeEvent);
    //did_partially_match_bindings = atom.keymaps.onDidPartiallyMatchBindings(changeEvent);
    did_fail_to_match_binding = atom.keymaps.onDidFailToMatchBinding(changeEvent);
  }

  consumeStatusBar(status_bar) {
    status_bar_tile = status_bar.addRightTile({
      item: document.createElement('a'),
      priority: 1000
    });
    status_bar_tile.item.className = 'inline-block';
    updateStatusBar();
  }

  deactivate() {
    console.log('code-stats-atom', PACKAGE_VERSION, 'deactivating, unsubscribing from events.');

    if (status_bar_tile !== null) {
      status_bar_tile.destroy();
      status_bar_tile = null;
    }

    for (let disposable of [
      did_change_api_key,
      did_change_api_url,
      //did_match_binding,
      //did_partially_match_bindings,
      did_fail_to_match_binding
    ]) {
      disposable.dispose();
    }
  }
}

export default new CodeStatsAtom();
