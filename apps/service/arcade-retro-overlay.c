#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/shape.h>

#include <ctype.h>
#include <errno.h>
#include <netdb.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#define DEFAULT_HOST "127.0.0.1"
#define DEFAULT_PORT 5174
#define DEFAULT_PATH "/arcade-life/overlay-state"
#define DEFAULT_WIDTH 1440
#define DEFAULT_HEIGHT 40
#define DEFAULT_X 0
#define DEFAULT_Y 800
#define DEFAULT_POLL_MS 250
#define DEFAULT_FONT "-misc-fixed-bold-r-normal--18-120-100-100-c-90-iso10646-1"
#define FALLBACK_FONT "fixed"
#define MAX_HTTP_RESPONSE 32768
#define MAX_TEXT 256

typedef struct {
  int x;
  int y;
  int width;
  int height;
  int poll_ms;
  int port;
  const char *host;
  const char *path;
  bool verbose;
} Config;

typedef struct {
  unsigned long text;
  unsigned long fill;
  unsigned long shadow;
} ThemeColors;

typedef struct {
  bool visible;
  char left[MAX_TEXT];
  char center[MAX_TEXT];
  char right[MAX_TEXT];
} OverlayState;

static void log_line(const Config *config, const char *message) {
  if (!config->verbose) return;
  fprintf(stderr, "[arcade-retro-overlay] %s\n", message);
}

static void trim_spaces(char *value) {
  size_t len = strlen(value);
  size_t start = 0;
  while (start < len && isspace((unsigned char)value[start])) start++;
  while (len > start && isspace((unsigned char)value[len - 1])) len--;
  if (start > 0 || len < strlen(value)) memmove(value, value + start, len - start);
  value[len - start] = '\0';
}

static bool extract_json_bool(const char *json, const char *key, bool default_value) {
  char pattern[64];
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char *start = strstr(json, pattern);
  if (!start) return default_value;
  start = strchr(start, ':');
  if (!start) return default_value;
  start++;
  while (*start && isspace((unsigned char)*start)) start++;
  if (strncmp(start, "true", 4) == 0) return true;
  if (strncmp(start, "false", 5) == 0) return false;
  return default_value;
}

static void json_unescape(const char *src, char *dest, size_t dest_size) {
  size_t out = 0;
  for (size_t i = 0; src[i] != '\0' && out + 1 < dest_size; i++) {
    if (src[i] == '\\') {
      i++;
      if (src[i] == '\0') break;
      switch (src[i]) {
        case 'n':
          dest[out++] = ' ';
          break;
        case 'r':
        case 't':
          dest[out++] = ' ';
          break;
        case '\\':
        case '"':
        case '/':
          dest[out++] = src[i];
          break;
        case 'u':
          if (out + 1 < dest_size) dest[out++] = '?';
          i += 4;
          break;
        default:
          dest[out++] = src[i];
          break;
      }
      continue;
    }
    dest[out++] = src[i];
  }
  dest[out] = '\0';
  trim_spaces(dest);
}

static void normalize_overlay_text(char *text) {
  if (!text || text[0] == '\0') return;

  char normalized[MAX_TEXT];
  size_t out = 0;

  for (size_t i = 0; text[i] != '\0' && out + 1 < sizeof(normalized);) {
    const unsigned char ch = (unsigned char)text[i];

    if (ch == 0xE2 && (unsigned char)text[i + 1] == 0x82 && (unsigned char)text[i + 2] == 0xB1) {
      normalized[out++] = 'P';
      i += 3;
      continue;
    }

    normalized[out++] = text[i++];
  }

  normalized[out] = '\0';

  // Convert " | " separator into newline for 2-row center display
  char with_break[MAX_TEXT];
  size_t wb_out = 0;
  for (size_t i = 0; normalized[i] != '\0' && wb_out + 1 < sizeof(with_break);) {
    if (normalized[i] == ' ' &&
        normalized[i + 1] == '|' &&
        normalized[i + 2] == ' ') {
      with_break[wb_out++] = '\n';
      i += 3;
      continue;
    }
    with_break[wb_out++] = normalized[i++];
  }
  with_break[wb_out] = '\0';

  strncpy(text, with_break, MAX_TEXT - 1);
  text[MAX_TEXT - 1] = '\0';
}

static void extract_json_string(const char *json, const char *key, char *dest, size_t dest_size) {
  char pattern[64];
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char *start = strstr(json, pattern);
  if (!start) {
    dest[0] = '\0';
    return;
  }
  start = strchr(start, ':');
  if (!start) {
    dest[0] = '\0';
    return;
  }
  start++;
  while (*start && isspace((unsigned char)*start)) start++;
  if (*start != '"') {
    dest[0] = '\0';
    return;
  }
  start++;
  char raw[MAX_TEXT * 2];
  size_t out = 0;
  bool escaped = false;
  for (const char *p = start; *p != '\0' && out + 1 < sizeof(raw); p++) {
    if (!escaped && *p == '"') break;
    if (!escaped && *p == '\\') {
      escaped = true;
      raw[out++] = *p;
      continue;
    }
    escaped = false;
    raw[out++] = *p;
  }
  raw[out] = '\0';
  json_unescape(raw, dest, dest_size);
}

static bool fetch_overlay_state(const Config *config, OverlayState *state) {
  struct addrinfo hints;
  struct addrinfo *result = NULL;
  char port_buf[16];
  snprintf(port_buf, sizeof(port_buf), "%d", config->port);

  memset(&hints, 0, sizeof(hints));
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;

  if (getaddrinfo(config->host, port_buf, &hints, &result) != 0) {
    return false;
  }

  int sock = socket(result->ai_family, result->ai_socktype, result->ai_protocol);
  if (sock < 0) {
    freeaddrinfo(result);
    return false;
  }

  struct timeval timeout;
  timeout.tv_sec = 1;
  timeout.tv_usec = 0;
  setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

  if (connect(sock, result->ai_addr, result->ai_addrlen) != 0) {
    close(sock);
    freeaddrinfo(result);
    return false;
  }

  freeaddrinfo(result);

  char request[512];
  int request_len = snprintf(
    request,
    sizeof(request),
    "GET %s HTTP/1.1\r\nHost: %s:%d\r\nConnection: close\r\n\r\n",
    config->path,
    config->host,
    config->port
  );

  if (write(sock, request, (size_t)request_len) < 0) {
    close(sock);
    return false;
  }

  char response[MAX_HTTP_RESPONSE];
  ssize_t total = 0;
  while (total < (ssize_t)(sizeof(response) - 1)) {
    ssize_t count = read(sock, response + total, sizeof(response) - 1 - (size_t)total);
    if (count <= 0) break;
    total += count;
  }
  close(sock);
  response[total] = '\0';

  char *body = strstr(response, "\r\n\r\n");
  if (!body) return false;
  body += 4;

  const char *footer = strstr(body, "\"footer\"");
  if (!footer) footer = body;

  state->visible = extract_json_bool(footer, "visible", true);
  extract_json_string(footer, "leftText", state->left, sizeof(state->left));
  extract_json_string(footer, "centerText", state->center, sizeof(state->center));
  extract_json_string(footer, "rightText", state->right, sizeof(state->right));
  normalize_overlay_text(state->left);
  normalize_overlay_text(state->center);
  normalize_overlay_text(state->right);
  return true;
}

static bool states_equal(const OverlayState *a, const OverlayState *b) {
  return a->visible == b->visible &&
         strcmp(a->left, b->left) == 0 &&
         strcmp(a->center, b->center) == 0 &&
         strcmp(a->right, b->right) == 0;
}

static unsigned long alloc_color(Display *display, int screen, const char *name, unsigned long fallback) {
  XColor color;
  XColor exact;
  if (XAllocNamedColor(display, DefaultColormap(display, screen), name, &color, &exact)) {
    return color.pixel;
  }
  return fallback;
}

static bool text_rect_for_zone(
  XFontStruct *font,
  int zone_x,
  int zone_w,
  int height,
  const char *text,
  bool center_emphasis,
  XRectangle *rect_out,
  int *text_x_out,
  int *text_y_out
) {
  if (!text || text[0] == '\0') return false;
  int direction = 0;
  int ascent = 0;
  int descent = 0;
  XCharStruct overall;
  XTextExtents(font, text, (int)strlen(text), &direction, &ascent, &descent, &overall);
  int text_w = overall.width;
  int text_x = zone_x + (zone_w - text_w) / 2;
  if (text_x < zone_x + 1) text_x = zone_x + 1;
  int text_y = (height + ascent - descent) / 2;
  int pad_x = center_emphasis ? 4 : 2;
  int pad_y = center_emphasis ? 2 : 1;
  rect_out->x = (short)(text_x - pad_x);
  rect_out->y = (short)(text_y - ascent - pad_y);
  rect_out->width = (unsigned short)(text_w + (pad_x * 2));
  rect_out->height = (unsigned short)(ascent + descent + (pad_y * 2));
  if (text_x_out) *text_x_out = text_x;
  if (text_y_out) *text_y_out = text_y;
  return true;
}

static bool text_rect_for_zone_multiline(
  XFontStruct *font,
  int zone_x,
  int zone_w,
  int height,
  const char *text,
  XRectangle *rect_out
) {
  if (!text || text[0] == '\0') return false;

  const char *newline = strchr(text, '\n');

  // fallback to single line
  if (!newline) {
    return text_rect_for_zone(font, zone_x, zone_w, height, text, true, rect_out, NULL, NULL);
  }

  char top[MAX_TEXT];
  char bottom[MAX_TEXT];

  size_t top_len = (size_t)(newline - text);
  strncpy(top, text, top_len);
  top[top_len] = '\0';

  strncpy(bottom, newline + 1, MAX_TEXT - 1);
  bottom[MAX_TEXT - 1] = '\0';

  int dir, asc, desc;
  XCharStruct overall_top, overall_bottom;

  XTextExtents(font, top, strlen(top), &dir, &asc, &desc, &overall_top);
  XTextExtents(font, bottom, strlen(bottom), &dir, &asc, &desc, &overall_bottom);

  int max_w = overall_top.width > overall_bottom.width
    ? overall_top.width
    : overall_bottom.width;

  int text_h = asc + desc;
  int line_gap = 6; // increased spacing between lines
  int total_h = text_h * 2 + line_gap;

  int pad_x = 4;
  int pad_y = 2;

  // MUST match draw_zone() vertical math
  int base_y = (height - total_h) / 2 + asc;
  int rect_y = base_y - asc - pad_y;

  rect_out->x = zone_x + (zone_w - max_w) / 2 - pad_x;
  rect_out->y = rect_y;
  rect_out->width = max_w + pad_x * 2;
  rect_out->height = total_h + pad_y * 2;

  return true;
}

static void draw_zone(
  Display *display,
  Window window,
  GC text_gc,
  GC shadow_gc,
  GC fill_gc,
  XFontStruct *font,
  int zone_x,
  int zone_w,
  int height,
  const char *text,
  bool center_emphasis
) {
  if (!text || text[0] == '\0') return;

  // Detect multiline (split by '\n')
  const char *newline = strchr(text, '\n');

  if (!center_emphasis || !newline) {
    // Default single-line behavior (unchanged)
    XRectangle rect;
    int text_x = 0;
    int text_y = 0;

    if (!text_rect_for_zone(font, zone_x, zone_w, height, text, center_emphasis, &rect, &text_x, &text_y)) return;

    XFillRectangle(display, window, fill_gc, rect.x, rect.y, rect.width, rect.height);
    XDrawString(display, window, shadow_gc, text_x + 1, text_y + 1, text, (int)strlen(text));
    XDrawString(display, window, text_gc, text_x, text_y, text, (int)strlen(text));
    return;
  }

  // --- MULTI-LINE CENTER RENDER (2 rows) ---
  char top[MAX_TEXT];
  char bottom[MAX_TEXT];

  size_t top_len = (size_t)(newline - text);
  strncpy(top, text, top_len);
  top[top_len] = '\0';

  strncpy(bottom, newline + 1, MAX_TEXT - 1);
  bottom[MAX_TEXT - 1] = '\0';

  // Measure both lines
  int dir, asc, desc;
  XCharStruct overall_top, overall_bottom;

  XTextExtents(font, top, (int)strlen(top), &dir, &asc, &desc, &overall_top);
  XTextExtents(font, bottom, (int)strlen(bottom), &dir, &asc, &desc, &overall_bottom);

  int text_h = asc + desc;
  int line_gap = 6; // increased spacing between lines
  int total_h = text_h * 2 + line_gap;

  int base_y = (height - total_h) / 2 + asc;

  int top_x = zone_x + (zone_w - overall_top.width) / 2;
  int bottom_x = zone_x + (zone_w - overall_bottom.width) / 2;

  int top_y = base_y;
  int bottom_y = base_y + text_h + line_gap;

  int pad_x = 4;
  int pad_y = 2;

  int rect_x = zone_x + (zone_w - (overall_top.width > overall_bottom.width ? overall_top.width : overall_bottom.width)) / 2 - pad_x;
  int rect_y = top_y - asc - pad_y;
  int rect_w = (overall_top.width > overall_bottom.width ? overall_top.width : overall_bottom.width) + pad_x * 2;
  int rect_h = total_h + pad_y * 2;

  XFillRectangle(display, window, fill_gc, rect_x, rect_y, rect_w, rect_h);

  // Draw top line
  XDrawString(display, window, shadow_gc, top_x + 1, top_y + 1, top, (int)strlen(top));
  XDrawString(display, window, text_gc, top_x, top_y, top, (int)strlen(top));

  // Draw bottom line
  XDrawString(display, window, shadow_gc, bottom_x + 1, bottom_y + 1, bottom, (int)strlen(bottom));
  XDrawString(display, window, text_gc, bottom_x, bottom_y, bottom, (int)strlen(bottom));
}

static void apply_window_shape(Display *display, Window window, XFontStruct *font, const Config *config, const OverlayState *state) {
  int zone_w = config->width / 3;
  XRectangle rects[4];
  int rect_count = 0;

  if (state->visible) {
    if (text_rect_for_zone(font, 0, zone_w, config->height, state->left, false, &rects[rect_count], NULL, NULL)) {
      rect_count++;
    }
    if (text_rect_for_zone_multiline(font, zone_w, zone_w, config->height, state->center, &rects[rect_count])) {
      rect_count++;
    }
    if (text_rect_for_zone(font, zone_w * 2, config->width - (zone_w * 2), config->height, state->right, false, &rects[rect_count], NULL, NULL)) {
      rect_count++;
    }
  }

  if (rect_count == 0) {
    rects[0].x = 0;
    rects[0].y = (short)(config->height - 1);
    rects[0].width = 1;
    rects[0].height = 1;
    rect_count = 1;
  }

  XShapeCombineRectangles(display, window, ShapeBounding, 0, 0, rects, rect_count, ShapeSet, 0);
}

static void render(
  Display *display,
  Window window,
  GC left_text_gc,
  GC left_shadow_gc,
  GC left_fill_gc,
  GC center_text_gc,
  GC center_shadow_gc,
  GC center_fill_gc,
  XFontStruct *font,
  const Config *config,
  const OverlayState *state
) {
  XClearWindow(display, window);

  int zone_w = config->width / 3;
  if (state->visible) {
    draw_zone(display, window, left_text_gc, left_shadow_gc, left_fill_gc, font, 0, zone_w, config->height, state->left, false);
    draw_zone(display, window, center_text_gc, center_shadow_gc, center_fill_gc, font, zone_w, zone_w, config->height, state->center, true);
    draw_zone(display, window, left_text_gc, left_shadow_gc, left_fill_gc, font, zone_w * 2, config->width - (zone_w * 2), config->height, state->right, false);
  }
  XFlush(display);
}

static void parse_args(int argc, char **argv, Config *config) {
  config->x = DEFAULT_X;
  config->y = DEFAULT_Y;
  config->width = DEFAULT_WIDTH;
  config->height = DEFAULT_HEIGHT;
  config->poll_ms = DEFAULT_POLL_MS;
  config->port = DEFAULT_PORT;
  config->host = DEFAULT_HOST;
  config->path = DEFAULT_PATH;
  config->verbose = false;

  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--x") == 0 && i + 1 < argc) config->x = atoi(argv[++i]);
    else if (strcmp(argv[i], "--y") == 0 && i + 1 < argc) config->y = atoi(argv[++i]);
    else if (strcmp(argv[i], "--width") == 0 && i + 1 < argc) config->width = atoi(argv[++i]);
    else if (strcmp(argv[i], "--height") == 0 && i + 1 < argc) config->height = atoi(argv[++i]);
    else if (strcmp(argv[i], "--poll-ms") == 0 && i + 1 < argc) config->poll_ms = atoi(argv[++i]);
    else if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) config->port = atoi(argv[++i]);
    else if (strcmp(argv[i], "--host") == 0 && i + 1 < argc) config->host = argv[++i];
    else if (strcmp(argv[i], "--path") == 0 && i + 1 < argc) config->path = argv[++i];
    else if (strcmp(argv[i], "--verbose") == 0) config->verbose = true;
  }
}

int main(int argc, char **argv) {
  Config config;
  parse_args(argc, argv, &config);

  Display *display = XOpenDisplay(NULL);
  if (!display) {
    fprintf(stderr, "[arcade-retro-overlay] failed to open display\n");
    return 1;
  }

  int screen = DefaultScreen(display);
  Window root = RootWindow(display, screen);

  XSetWindowAttributes attrs;
  memset(&attrs, 0, sizeof(attrs));
  attrs.override_redirect = True;
  attrs.background_pixel = BlackPixel(display, screen);
  attrs.border_pixel = BlackPixel(display, screen);
  attrs.save_under = False;

  Window window = XCreateWindow(
    display,
    root,
    config.x,
    config.y,
    (unsigned int)config.width,
    (unsigned int)config.height,
    0,
    CopyFromParent,
    InputOutput,
    CopyFromParent,
    CWOverrideRedirect | CWBackPixel | CWBorderPixel | CWSaveUnder,
    &attrs
  );

  XStoreName(display, window, "Arcade Retro Overlay Native");
  XSelectInput(display, window, ExposureMask);
  XMapRaised(display, window);

  XFontStruct *font = XLoadQueryFont(display, FALLBACK_FONT);

  if (!font) {
    fprintf(stderr, "[arcade-retro-overlay] failed to load fallback font\n");
    XDestroyWindow(display, window);
    XCloseDisplay(display);
    return 1;
  }

  ThemeColors side_theme = {
    .text = alloc_color(display, screen, "#d4af37", WhitePixel(display, screen)),
    .fill = alloc_color(display, screen, "#020202", BlackPixel(display, screen)),
    .shadow = alloc_color(display, screen, "#000000", BlackPixel(display, screen)),
  };
  ThemeColors center_theme = {
    .text = alloc_color(display, screen, "#ffd84d", WhitePixel(display, screen)),
    .fill = alloc_color(display, screen, "#020202", BlackPixel(display, screen)),
    .shadow = alloc_color(display, screen, "#000000", BlackPixel(display, screen)),
  };

  GC left_text_gc = XCreateGC(display, window, 0, NULL);
  GC left_shadow_gc = XCreateGC(display, window, 0, NULL);
  GC left_fill_gc = XCreateGC(display, window, 0, NULL);
  GC center_text_gc = XCreateGC(display, window, 0, NULL);
  GC center_shadow_gc = XCreateGC(display, window, 0, NULL);
  GC center_fill_gc = XCreateGC(display, window, 0, NULL);

  XSetForeground(display, left_text_gc, side_theme.text);
  XSetForeground(display, left_shadow_gc, side_theme.shadow);
  XSetForeground(display, left_fill_gc, side_theme.fill);
  XSetForeground(display, center_text_gc, center_theme.text);
  XSetForeground(display, center_shadow_gc, center_theme.shadow);
  XSetForeground(display, center_fill_gc, center_theme.fill);

  XSetFont(display, left_text_gc, font->fid);
  XSetFont(display, left_shadow_gc, font->fid);
  XSetFont(display, center_text_gc, font->fid);
  XSetFont(display, center_shadow_gc, font->fid);

  OverlayState current = { .visible = true, .left = "", .center = "", .right = "" };
  OverlayState next = { .visible = true, .left = "", .center = "", .right = "" };
  apply_window_shape(display, window, font, &config, &current);

  while (1) {
    while (XPending(display) > 0) {
      XEvent event;
      XNextEvent(display, &event);
      if (event.type == Expose) {
        render(display, window, left_text_gc, left_shadow_gc, left_fill_gc, center_text_gc, center_shadow_gc, center_fill_gc, font, &config, &current);
      }
    }

    if (fetch_overlay_state(&config, &next)) {
      if (!states_equal(&current, &next)) {
        current = next;
        apply_window_shape(display, window, font, &config, &current);
        render(display, window, left_text_gc, left_shadow_gc, left_fill_gc, center_text_gc, center_shadow_gc, center_fill_gc, font, &config, &current);
      }
    } else {
      log_line(&config, "overlay-state fetch failed");
    }

    struct timespec sleep_time;
    sleep_time.tv_sec = config.poll_ms / 1000;
    sleep_time.tv_nsec = (long)(config.poll_ms % 1000) * 1000000L;
    nanosleep(&sleep_time, NULL);
  }

  return 0;
}
