window.ensurePermissions = async function (type = "audio") {
  const constraints = type === "video"
    ? { video: true, audio: true }
    : { audio: true };

  try {
    const permName = type === "video" ? "camera" : "microphone";

    if (navigator.permissions && navigator.permissions.query) {
      const status = await navigator.permissions.query({ name: permName });

      if (status.state === "denied") {
        alert(`Permission to access your ${permName} was denied. Please allow it in settings.`);
        return null;
      }
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;

  } catch (err) {
    console.error("⚠️ Permission or getUserMedia failed:", err);
    alert(`Could not access your ${type}. Please allow it in settings.`);
    return null;
  }
};
