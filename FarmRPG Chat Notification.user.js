// ==UserScript==
// @name         Chat Notification
// @namespace    https://natsulus.com
// @version      0.2.1
// @description  Desktop Notification when pinged in selected Chat Channel
// @author       Natsulus
// @match        https://*.farmrpg.com/index.php
// @match        https://*.farmrpg.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=farmrpg.com
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @require      http://code.jquery.com/jquery-3.6.0.min.js
// @require      https://raw.githubusercontent.com/erming/tabcomplete/refs/heads/gh-pages/src/tabcomplete.min.js
// @require      https://moment.github.io/luxon/global/luxon.min.js
// ==/UserScript==

/* globals $, luxon */

const DateTime = luxon.DateTime;

let notifEnabled = GM_getValue("notifEnabled", false);
let focusPing = true;
const today = new Date();
today.setUTCHours(0);
today.setUTCMinutes(0);
today.setUTCSeconds(0);

let prevNotifTime = DateTime.fromISO(
  GM_getValue("prevNotifTime", "1970-01-01T00:00:00Z")
);

let notifCheckbox = $(`<input>`)
  .prop("type", "checkbox")
  .prop("value", "1")
  .prop("checked", notifEnabled)
  .prop("name", "ccnotif")
  .prop("id", "ccnotif")
  .hide();
let notifLabel = $(`<label>`)
  .prop("for", "ccnotif")
  .addClass("cclink")
  .text("Notify");
notifCheckbox.change((e) => {
  notifEnabled = e.currentTarget.checked;
  GM_setValue("notifEnabled", notifEnabled);
});


$("#desktopchatpanel .cclink").last().after(notifCheckbox, notifLabel);

const chatPanelBgColor = $("#desktopchatpanel").css("background-color");
// Calculate the sum of the RGB values to determine if it's light or dark.
const approxBrightness = chatPanelBgColor
  .substring(4, chatPanelBgColor.length - 1)
  .replace(/ /g, "")
  .split(",")
  .reduce((sum, x) => sum + Number(x), 0);
const darkMode = approxBrightness < 3 * 100;
console.log("Dark Mode:", darkMode);
if (darkMode) {
  $(`<style>
  #ccnotif+label {background-color: #400; color: #fb7a24}
  #ccnotif:checked +label {background-color: #041}
  .original-highlight-message { background-color: #222 }
  .author-highlight-message { background-color: #220 }
  .tag-highlight-message { background-color: #303 }
  </style>`).appendTo("head");
} else {
  $(`<style>
  #ccnotif+label {background-color: #400; color: #fb7a24}
  #ccnotif:checked +label {background-color: #041}
  .original-highlight-message { background-color: #ddd }
  .author-highlight-message { background-color: #ddf }
  .tag-highlight-message { background-color: #cfc }
  </style>`).appendTo("head");
}

const messages = [];

let messagesByAuthor = {};
let messagesByTag = {};

// Replace a DOM element with a new tag, preserving attributes and children.
function replaceTag(element, newTag) {
  const newElement = document.createElement(newTag);
  for (const attr of element.attributes) {
    newElement.setAttribute(attr.name, attr.value);
  }
  while (element.firstChild) {
    newElement.appendChild(element.firstChild);
  }
  element.replaceWith(newElement);

  if (element.style.length > 0) {
    newElement.style.cssText = element.style.cssText;
  }

  return newElement;
}

function getThread(author1, author2) {
  const messages1 = messagesByAuthor[author1] || [];
  const messages2 = messagesByAuthor[author2] || [];
  const messages3 = messagesByTag[author1] || [];
  const messages4 = messagesByTag[author2] || [];
  const messages = messages1.concat(messages2, messages3, messages4);
  messages.sort();
  for (const m of messages) {
    const [time, author, text, chat] = m;
  }
  return messages;
}

function getChatAuthorFromChat(chat) {
  let chatAuthor = chat.childNodes[2].textContent;
  const mailBoxIndicator = chatAuthor.indexOf("[");
  if (mailBoxIndicator >= 0) {
    chatAuthor = chatAuthor.substr(0, mailBoxIndicator - 1);
  }
  return chatAuthor;
}

let currentSelected = null;
let currentHighlightedElements = [];

function highlightChatsFromChat(chat) {
  currentHighlightedElements = [];
  let chatAuthor = getChatAuthorFromChat(chat);
  const thread = getThread(chatAuthor, "");
  for (const m of thread) {
    const elm = m[3];
    if (elm == chat || elm.textContent == chat.textContent) {
      $(elm).addClass("original-highlight-message");
    } else if (m[1] == chatAuthor) {
      $(elm).addClass("author-highlight-message");
    } else {
      $(elm).addClass("tag-highlight-message");
    }
    currentHighlightedElements.push(elm);
  }
}

function selectChat(event) {
  for (const elm of currentHighlightedElements) {
    // remove highlight
    $(elm).removeClass("original-highlight-message");
    $(elm).removeClass("author-highlight-message");
    $(elm).removeClass("tag-highlight-message");
  }
  currentHighlightedElements = [];
  const chat = event.currentTarget;
  // Check textContent as well because a refresh causes the element to be recreated
  // so reference equality doesn't work.
  if (
    currentSelected == chat ||
    (currentSelected != null && currentSelected.textContent == chat.textContent)
  ) {
    currentSelected = null;
    return;
  }
  currentSelected = chat;
  highlightChatsFromChat(chat);
}

function checkForPing(chatList) {
  let newMessages = [];

  messagesByTag = {};
  messagesByAuthor = {};
  for (let chat of chatList) {
    let timeString = chat.childNodes[0].textContent;
    let notifTime = DateTime.fromString(timeString, "hh:mm:ss a", {
      zone: "America/Chicago",
    }).setZone("Europe/London");

    let chatAuthor = getChatAuthorFromChat(chat);

    let chatContent = chat.childNodes[7].textContent;
    for (let anchor of $(chat.childNodes[7]).children("a")) {
      if (anchor.href.indexOf("profile.php") >= 0) {
        let tag = anchor.textContent.substr(1);
        let messageList = messagesByTag[tag];
        if (messageList === undefined) {
          messageList = [];
          messagesByTag[tag] = messageList;
        }
        messageList.push([notifTime, chatAuthor, chatContent, chat]);
      }
    }
    let messageList = messagesByAuthor[chatAuthor];
    if (messageList === undefined) {
      messageList = [];
      messagesByAuthor[chatAuthor] = messageList;
    }
    messageList.push([notifTime, chatAuthor, chatContent, chat]);
    $(chat).on("click", selectChat);

    // Ideally we'd do this per chat channel in case you were chatting
    // on more than one.
    if (notifTime.valueOf() > prevNotifTime.valueOf()) {
      newMessages.push([notifTime, chatAuthor, chatContent]);

      if ($(chat).is("[style]") && !$(chat).hasClass("redstripes")) {
        if (!notifEnabled || (!focusPing && document.hasFocus())) {
          break;
        }

        GM_notification({
          title: chatAuthor,
          text: chatContent,
        });
      }
    }
  }

  if (newMessages.length > 0) {
    prevNotifTime = newMessages[0][0];
    GM_setValue("prevNotifTime", prevNotifTime.toISO());
  }

  // console.log("New Messages:");
  for (let i = newMessages.length - 1; i >= 0; --i) {
    let message = newMessages[i];
    messages.push(message);
    let [notifTime, chatAuthor, chatContent, chat] = message;
    const notifTimeString = notifTime.toFormat("HH:mm:ss");
    // console.log(`${notifTimeString} ${chatAuthor}: ${chatContent}`);
  }

  if (currentSelected) {
    highlightChatsFromChat(currentSelected);
  }
}

$(document).ready(function () {
  const original_chat_box = $("#chat_txt_desktop");
  // const chat_box = $(replaceTag(original_chat_box[0], "textarea"));
  const chat_box = original_chat_box;

  chat_box.tabcomplete([
    "((Apple Cider))",
    "((Arnold Palmer))",
    "((Arrowhead))",
    "((Blue Dye))",
    "((Carrot))",
    "((Caterpillar))",
    "((Cucumber))",
    "((Eggplant))",
    "((Feathers))",
    "((Glass Orb))",
    "((Gold Feather))",
    "((Green Dye))",
    "((Heart Container))",
    "((Hops))",
    "((Large Net))",
    "((Leather))",
    "((Leek))",
    "((Mushroom Paste))",
    "((Mushroom))",
    "((Onion))",
    "((Orange Juice))",
    "((Peas))",
    "((Peppers))",
    "((Potato))",
    "((Purple Dye))",
    "((Purple Flower))",
    "((Radish))",
    "((Red Dye))",
    "((Rope))",
    "((Tomato))",
    "((Twine))",
    "((Shrimp-a-Plenty))",
    "((Yarn))",
  ]);

  let target = document.querySelector("#chatzoneDesktop");
  let observer = new MutationObserver((mutation) => {
    checkForPing($(mutation[0].addedNodes).filter(".chat-txt"));
  });
  let config = {
    subtree: true,
    childList: true,
  };
  observer.observe(target, config);
});
