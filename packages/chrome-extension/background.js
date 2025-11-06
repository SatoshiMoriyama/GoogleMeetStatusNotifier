chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "sendWebhook") {
    fetch(request.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request.data),
    })
      .then((response) => response.json())
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
