// Plays the completion sound, then tells the background it can close this page.
const audio = new Audio('task_completed.mp3');
audio.onended = () => chrome.runtime.sendMessage('sound-done');
audio.play();
