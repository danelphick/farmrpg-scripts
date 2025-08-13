function updateRaptors(url) {
  const league = url.searchParams.get("league");
  if (!league) return;

  chrome.storage.local.get(["raptors"]).then((result) => {
    storedRaptors = result.raptors;
    if (storedRaptors == null) {
      storedRaptors = {};
    }
    if (storedRaptors[league] == null) {
      storedRaptors[league] = {};
    }
    let leagueRaptors = storedRaptors[league];
    const currentDate = new Date().toDateString();
    if (leagueRaptors?.date != currentDate) {
      // It's a new day, so blank all the previous win-loss data.
      storedRaptors[league] = leagueRaptors = {};
      leagueRaptors.date = currentDate;
    }

    const raptors = document.querySelectorAll(
      "li .item-content .item-inner .item-title"
    );

    for (let raptor of raptors) {
      const leagueRecordElm = raptor.children[2];
      const winLossElm = leagueRecordElm?.children[0];
      const winLoss = winLossElm?.textContent;
      if (winLoss == null) continue;
      const name = raptor.children[0].textContent;
      const trainer = leagueRecordElm.children[3].textContent;
      const key = `${trainer}:${name}`;

      // Check we haven't already added the score difference.
      if (winLoss.indexOf(")") != -1) continue;

      const index1 = winLoss.indexOf(" ");
      const win = Number(winLoss.substring(0, index1).replaceAll(",", ""));
      const loss = Number(
        winLoss
          .substring(winLoss.indexOf(" ", index1 + 1) + 1)
          .replaceAll(",", "")
      );
      lastResults = leagueRaptors[key];
      winAtStartOfDay = lastResults?.winAtStartOfDay ?? win;
      lossAtStartOfDay = lastResults?.lossAtStartOfDay ?? loss;

      const positionElm = raptor.parentElement.children[1];
      const position = Number(positionElm.textContent.substring(1));
      const lastPosition = lastResults?.positionAtStartOfDay ?? position;
      const greenStyle = "color: #00bc01; margin-right: 1ch;";
      const redStyle = "color: #e21e1e; margin-right: 1ch;";
      if (position != lastPosition) {
        arrow = document.createElement("span");
        if (position > lastPosition) {
          arrow.textContent = (position - lastPosition).toString() + "▼";
          arrow.style = redStyle;
        } else {
          arrow.textContent = (lastPosition - position).toString() + "▲";
          arrow.style = greenStyle;
        }
        positionElm.insertBefore(arrow, positionElm.firstChild);
      }
      leagueRaptors[key] = {
        win: win,
        loss: loss,
        positionAtStartOfDay: lastPosition,
        winAtStartOfDay: winAtStartOfDay,
        lossAtStartOfDay: lossAtStartOfDay,
      };
      const diff = win - loss;
      const detail = `${winLoss} (${diff > 0 ? "+" : ""}${diff}) (W${
        win - winAtStartOfDay
      } L${loss - lossAtStartOfDay} today)`;
      winLossElm.textContent = detail;
    }
    chrome.storage.local.set({ raptors: storedRaptors });
  });
}


function addLocationObserver(callback) {
  // Options for the observer (which mutations to observe)
  const config = { attributes: false, childList: true, subtree: false };

  // Create an observer instance linked to the callback function
  const observer = new MutationObserver(callback);

  // Start observing the target node for configured mutations
  observer.observe(document.body, config);
}

function observerCallback() {
  const url = new URL(window.location.href.replace("#!", ""));
  const pathname = url.pathname;
  if (pathname.endsWith("/rfcrankings.php")) {
    updateRaptors(url);
  }
}

addLocationObserver(observerCallback);
observerCallback();
