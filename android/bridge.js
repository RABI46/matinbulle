/* Injecté après le chargement de la page, uniquement dans l'APK.
   Le WebView Android n'expose pas la synthèse vocale du navigateur : on la
   remplace par un pont vers le TextToSpeech du système, avec l'API attendue
   par app.js (SpeechSynthesisUtterance, speak, cancel, getVoices). */
(function () {
  var bridge = window.AndroidBridge;
  if (!bridge || !bridge.speak) return;

  function Utterance(text) {
    this.text = text == null ? "" : String(text);
    this.lang = "fr-FR";
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
  }

  var synth = {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    speak: function (utterance) {
      var text = utterance && utterance.text ? String(utterance.text) : "";
      if (!text) return;
      synth.speaking = true;
      try {
        bridge.speak(text, utterance.lang || "fr-FR", Number(utterance.rate) || 1);
      } catch (e) {
        synth.speaking = false;
        return;
      }
      if (typeof utterance.onstart === "function") {
        setTimeout(function () {
          utterance.onstart();
        }, 0);
      }
      if (typeof utterance.onend === "function") {
        // Approximation : on rend la main quand la voix a fini de lire.
        setTimeout(function () {
          synth.speaking = false;
          utterance.onend();
        }, Math.max(1200, text.length * 70));
      }
    },
    cancel: function () {
      synth.speaking = false;
      try {
        bridge.stop();
      } catch (e) {
        /* rien à faire */
      }
    },
    pause: function () {
      synth.paused = true;
      synth.cancel();
    },
    resume: function () {
      synth.paused = false;
    },
    getVoices: function () {
      return [
        {
          name: "Synthèse Android",
          lang: "fr-FR",
          voiceURI: "android-tts",
          localService: true,
          default: true,
        },
      ];
    },
    addEventListener: function () {},
    removeEventListener: function () {},
  };

  try {
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: Utterance,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "speechSynthesis", {
      value: synth,
      configurable: true,
      writable: true,
    });
  } catch (e) {
    window.SpeechSynthesisUtterance = Utterance;
    window.speechSynthesis = synth;
  }
})();
