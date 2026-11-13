/**
 * Gemini RTL - Popup Logic
 * Handles user preferences and chrome.storage.sync synchronization.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const toggleAutoResponse = document.getElementById('toggleAutoResponse');
  const toggleAutoInput = document.getElementById('toggleAutoInput');
  const toggleForceCodeMath = document.getElementById('toggleForceCodeMath');
  const toggleVazirmatn = document.getElementById('toggleVazirmatn');

  const defaults = {
    autoDetectResponse: true,
    autoDetectInput: true,
    forceCodeMathLTR: true,
    useVazirmatn: false
  };

  try {
    const stored = await chrome.storage.sync.get(defaults);
    toggleAutoResponse.checked = stored.autoDetectResponse;
    toggleAutoInput.checked = stored.autoDetectInput;
    toggleForceCodeMath.checked = stored.forceCodeMathLTR;
    toggleVazirmatn.checked = stored.useVazirmatn;
  } catch (err) {
    console.error('Gemini RTL: Failed to load settings:', err);
  }

  toggleAutoResponse.addEventListener('change', async () => {
    try {
      await chrome.storage.sync.set({ autoDetectResponse: toggleAutoResponse.checked });
    } catch (err) {
      console.error('Gemini RTL: Failed to save autoDetectResponse:', err);
    }
  });

  toggleAutoInput.addEventListener('change', async () => {
    try {
      await chrome.storage.sync.set({ autoDetectInput: toggleAutoInput.checked });
    } catch (err) {
      console.error('Gemini RTL: Failed to save autoDetectInput:', err);
    }
  });

  toggleForceCodeMath.addEventListener('change', async () => {
    try {
      await chrome.storage.sync.set({ forceCodeMathLTR: toggleForceCodeMath.checked });
    } catch (err) {
      console.error('Gemini RTL: Failed to save forceCodeMathLTR:', err);
    }
  });

  toggleVazirmatn.addEventListener('change', async () => {
    try {
      await chrome.storage.sync.set({ useVazirmatn: toggleVazirmatn.checked });
    } catch (err) {
      console.error('Gemini RTL: Failed to save useVazirmatn:', err);
    }
  });
});
