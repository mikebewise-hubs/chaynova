document.addEventListener("DOMContentLoaded", () => {
    const music = document.getElementById("bgMusic");
    const volumeSlider = document.getElementById("volumeSlider");
    const musicBtn = document.getElementById("musicBtn");
    const musicControl = document.querySelector(".music-control");

    if (!music || !volumeSlider || !musicBtn || !musicControl) {
        console.log("Music tool elements were not found.");
        return;
    }

    const savedVolume = localStorage.getItem("chaynovaMusicVolume");
    const savedPlaying = localStorage.getItem("chaynovaMusicPlaying");

    const startingVolume =
        savedVolume !== null ? Number(savedVolume) : 29;

    music.volume = startingVolume / 100;
    volumeSlider.value = startingVolume;

    // Detect iPhone or iPad
    const isiOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (
            navigator.platform === "MacIntel" &&
            navigator.maxTouchPoints > 1
        );

    if (isiOS) {
        musicControl.classList.add("ios");
        musicBtn.title = "Use your iPhone volume buttons";
    }

    function updateButton() {
        if (music.paused || music.volume === 0) {
            musicBtn.textContent = "🔇";
            musicBtn.title = "Play Music";
        } else {
            musicBtn.textContent = "🔊";
            musicBtn.title = "Pause Music";
        }
    }

    musicBtn.addEventListener("click", async () => {
        try {
            if (music.paused) {
                await music.play();
                localStorage.setItem("chaynovaMusicPlaying", "true");
            } else {
                music.pause();
                localStorage.setItem("chaynovaMusicPlaying", "false");
            }

            updateButton();
        } catch (error) {
            console.log("Music could not start:", error);
        }
    });

    volumeSlider.addEventListener("input", () => {
        const volume = Number(volumeSlider.value);

        music.volume = volume / 100;

        localStorage.setItem(
            "chaynovaMusicVolume",
            volume.toString()
        );

        updateButton();
    });

    music.addEventListener("play", updateButton);
    music.addEventListener("pause", updateButton);

    // Try to continue music on the next page
    if (savedPlaying === "true") {
        music.play().catch(() => {
            console.log("Tap the music button to start music.");
        });
    }

    updateButton();
});