#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <linux/uinput.h>
#include <linux/input.h>
#include <sys/ioctl.h>
#include <errno.h>

static void die(const char *msg) {
    perror(msg);
    exit(EXIT_FAILURE);
}

int main(int argc, char *argv[]) {

    const char *device_name = "Arcade Virtual";

    if (argc >= 2)
        device_name = argv[1];

    int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd < 0)
        die("open /dev/uinput");

    /* Enable event types */
    if (ioctl(fd, UI_SET_EVBIT, EV_KEY) < 0) die("UI_SET_EVBIT EV_KEY");
    if (ioctl(fd, UI_SET_EVBIT, EV_SYN) < 0) die("UI_SET_EVBIT EV_SYN");

    /* Face buttons */

    ioctl(fd, UI_SET_KEYBIT, BTN_A);
    ioctl(fd, UI_SET_KEYBIT, BTN_B);
    ioctl(fd, UI_SET_KEYBIT, BTN_X);
    ioctl(fd, UI_SET_KEYBIT, BTN_Y);
    ioctl(fd, UI_SET_KEYBIT, BTN_START);
    ioctl(fd, UI_SET_KEYBIT, BTN_SELECT);

    ioctl(fd, UI_SET_KEYBIT, BTN_TL);
    ioctl(fd, UI_SET_KEYBIT, BTN_TR);
    ioctl(fd, UI_SET_KEYBIT, BTN_TL2);
    ioctl(fd, UI_SET_KEYBIT, BTN_TR2);

    /* Digital D-Pad */
    ioctl(fd, UI_SET_KEYBIT, BTN_DPAD_UP);
    ioctl(fd, UI_SET_KEYBIT, BTN_DPAD_DOWN);
    ioctl(fd, UI_SET_KEYBIT, BTN_DPAD_LEFT);
    ioctl(fd, UI_SET_KEYBIT, BTN_DPAD_RIGHT);

    struct uinput_setup usetup;
    memset(&usetup, 0, sizeof(usetup));

    snprintf(usetup.name, UINPUT_MAX_NAME_SIZE, "%s", device_name);

    usetup.id.bustype = BUS_USB;
    usetup.id.vendor  = 0x1234;
    usetup.id.product = 0x5678;
    usetup.id.version = 1;

    if (ioctl(fd, UI_DEV_SETUP, &usetup) < 0)
        die("UI_DEV_SETUP");

    if (ioctl(fd, UI_DEV_CREATE) < 0)
        die("UI_DEV_CREATE");

    sleep(1);

    struct input_event ev;

    while (1) {
        char buffer[64];

        if (!fgets(buffer, sizeof(buffer), stdin))
            break;

        int type, code, value;

        if (sscanf(buffer, "%d %d %d", &type, &code, &value) == 3) {

            memset(&ev, 0, sizeof(ev));
            ev.type = type;
            ev.code = code;
            ev.value = value;

            if (write(fd, &ev, sizeof(ev)) < 0)
                die("write event");

            memset(&ev, 0, sizeof(ev));
            ev.type = EV_SYN;
            ev.code = SYN_REPORT;
            ev.value = 0;

            if (write(fd, &ev, sizeof(ev)) < 0)
                die("write syn");
        }
    }

    ioctl(fd, UI_DEV_DESTROY);
    close(fd);
    return 0;
}
