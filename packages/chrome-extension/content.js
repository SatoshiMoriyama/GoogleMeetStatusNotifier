const SELECTORS = {
  LEAVE_BUTTON: 'button[aria-label*="Leave call"], button[aria-label*="通話から退出"]',
  JOIN_BUTTON_TEXT: ['Join now', '今すぐ参加']
};

const STATES = {
  IDLE: 'IDLE',
  PRE_MEETING: 'PRE_MEETING',
  IN_MEETING: 'IN_MEETING'
};

const WEBHOOK_URL = CONFIG.WEBHOOK_URL;

if (window.location.hostname === 'meet.google.com') {
  let currentState = STATES.IDLE;
    
  const detectState = () => {
    const leaveButton = document.querySelector(SELECTORS.LEAVE_BUTTON);

    if (leaveButton) return STATES.IN_MEETING;
    
    const hasJoinButton = Array.from(document.querySelectorAll('button span'))
      .some(span => SELECTORS.JOIN_BUTTON_TEXT.some(text => span.textContent.includes(text)));
    
    return hasJoinButton ? STATES.PRE_MEETING : STATES.IDLE;
  };
  
  const sendWebhook = async (status) => {
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: status,
          timestamp: new Date().toISOString()
        })
      });
    } catch (error) {
      console.error(`[Webhook] ${status} 送信エラー:`, error);
    }
  };
  
  // 状態変化ハンドラ
  const handleStateChange = (oldState, newState) => {    
    if (newState === STATES.IN_MEETING && oldState !== STATES.IN_MEETING) {
      console.log('✅ 会議開始を検知');
      sendWebhook('meeting_started');
    } else if (oldState === STATES.IN_MEETING && newState !== STATES.IN_MEETING) {
      console.log('❌ 会議終了を検知');
      sendWebhook('meeting_ended');
    }
  };
  
  // 状態チェック
  const checkState = () => {
    const newState = detectState();
    if (newState !== currentState) {
      handleStateChange(currentState, newState);
      currentState = newState;
    }
  };
  
  let throttleTimer = null;
  const throttledCheckState = () => {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      checkState();
      throttleTimer = null;
    }, 100);
  };
  
  const observer = new MutationObserver(throttledCheckState);
  observer.observe(document.body, { childList: true, subtree: true });
  
  window.addEventListener('pagehide', () => {
    if (currentState === STATES.IN_MEETING) {
      const data = new Blob([JSON.stringify({
        status: 'meeting_ended',
        timestamp: new Date().toISOString()
      })], { type: 'application/json' });
      navigator.sendBeacon(WEBHOOK_URL, data);
    }
  });
  
  // MutationObserver検知漏れ対応
  setInterval(checkState, 5000);
  
  checkState();
}