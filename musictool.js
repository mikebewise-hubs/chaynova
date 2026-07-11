
document.addEventListener("DOMContentLoaded", () => {
    // On music.html, use the jukebox player.
    // On other pages, use bgMusic.
    const music =
        document.getElementById("player") ||
        document.getElementById("bgMusic");

    const volumeSlider = document.getElementById("volumeSlider");
    const musicBtn = document.getElementById("musicBtn");
    const musicControl = document.querySelector(".music-control");

    if (!music || !volumeSlider || !musicBtn || !musicControl) {
        console.log("Music tool elements were not found.");
        return;
    }

    // Load the saved volume.
    // If no volume was saved, start at 29%.
    const savedVolume = localStorage.getItem("chaynovaMusicVolume");

    let startingVolume =
        savedVolume !== null ? Number(savedVolume) : 29;

    // Protect against invalid saved values.
    if (
        !Number.isFinite(startingVolume) ||
        startingVolume < 0 ||
        startingVolume > 100
    ) {
        startingVolume = 29;
    }

    music.volume = startingVolume / 100;
    volumeSlider.value = startingVolume;

    /*
        Detect iPhone and iPad.

        This includes:
        - iPhones and older iPads
        - Newer iPads that identify as MacIntel
        - Future touch-based Apple devices using a Mac-style identity
    */
    const isAppleMobileDevice =
        /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (
            navigator.platform === "MacIntel" &&
            navigator.maxTouchPoints > 1
        ) ||
        (
            /Mac/i.test(navigator.userAgent) &&
            navigator.maxTouchPoints > 1 &&
            "ontouchend" in document
        );

    if (isAppleMobileDevice) {
        musicControl.classList.add("ios");
        musicBtn.title =
            "Use your iPhone or iPad volume buttons";
    }

    function updateMusicButton() {
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
                /*
                    On music.html, load the default jukebox song
                    if the player does not have a song yet.
                */
                if (
                    music.id === "player" &&
                    !music.getAttribute("src")
                ) {
                    if (typeof loadDefaultSong === "function") {
                        loadDefaultSong();
                    }
                }

                await music.play();
            } else {
                music.pause();
            }

            updateMusicButton();
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

        updateMusicButton();
    });

    music.addEventListener("play", updateMusicButton);
    music.addEventListener("pause", updateMusicButton);
    music.addEventListener("volumechange", updateMusicButton);

    updateMusicButton();
});
