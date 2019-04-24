window.addEventListener("load", init);

function init() {
    window.addEventListener("keydown", e => {
        if (e.keyCode === 27 /* ESC */) {
            cancel();
        }
    });
    document.getElementById("pin-txt").addEventListener("keydown", e => {
        if (e.keyCode === 13 /* Enter */) {
            e.preventDefault();
            submit();
        }
    });
    document.getElementById("cancel-btn").addEventListener("click", cancel);
    document.getElementById("submit-btn").addEventListener("click", submit);
    document
        .getElementById("cache-chk")
        .addEventListener("click", () => document.getElementById("pin-txt").focus());

    for (const key of Object.keys(window.infoToShow)) {
        document.getElementById(key).textContent = window.infoToShow[key];
    }
}

function cancel() {
    window.cancelCallback();
    window.close();
}

function submit() {
    window.submitCallback(
        document.getElementById("pin-txt").value,
        document.getElementById("cache-chk").checked
    );
    window.close();
}
