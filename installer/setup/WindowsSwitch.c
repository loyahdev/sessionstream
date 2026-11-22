#define UNICODE
#define _UNICODE
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <wchar.h>

enum { setup_close = 1301, header_rule = 1302 };

static void fill(HDC dc, const RECT *area, COLORREF color)
{
    HBRUSH brush = CreateSolidBrush(color);
    if (brush != NULL) {
        FillRect(dc, area, brush);
        DeleteObject(brush);
    }
}

static void draw_switch(const DRAWITEMSTRUCT *item)
{
    BOOL pressed = (item->itemState & ODS_SELECTED) != 0;
    BOOL disabled = (item->itemState & ODS_DISABLED) != 0;
    HDC dc = item->hDC;
    RECT well = item->rcItem;
    int inset = (well.bottom - well.top) / 9;
    RECT cap = well;
    const COLORREF color = disabled ? RGB(80, 103, 73)
                          : pressed ? RGB(170, 207, 101) : RGB(194, 232, 121);
    fill(dc, &cap, color);
    RECT lip = cap;
    lip.top = lip.bottom - (inset > 1 ? inset - 1 : 1);
    fill(dc, &lip, RGB(104, 133, 69));

    WCHAR label[128];
    GetWindowTextW(item->hwndItem, label, ARRAYSIZE(label));
    int saved = SaveDC(dc);
    HFONT font = (HFONT)SendMessageW(item->hwndItem, WM_GETFONT, 0, 0);
    if (font != NULL) SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, disabled ? RGB(238, 243, 231) : RGB(11, 19, 15));
    DrawTextW(dc, label, -1, &cap, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    if (item->itemState & ODS_FOCUS) {
        InflateRect(&cap, -2, -2);
        DrawFocusRect(dc, &cap);
    }
    if (saved != 0) RestoreDC(dc, saved);
}

static LRESULT CALLBACK parent_proc(HWND window, UINT message, WPARAM wparam,
                                    LPARAM lparam, UINT_PTR id, DWORD_PTR data)
{
    (void)data;
    if (message == WM_NCHITTEST) {
        POINT cursor = { GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam) };
        RECT header, close;
        if (GetWindowRect(GetDlgItem(window, header_rule), &header)
            && GetWindowRect(GetDlgItem(window, setup_close), &close)
            && cursor.y < header.bottom && !PtInRect(&close, cursor))
            return HTCAPTION;
    }
    if (message == WM_COMMAND && LOWORD(wparam) == setup_close && HIWORD(wparam) == BN_CLICKED) {
        HWND cancel = GetDlgItem(window, IDCANCEL);
        int target = IsWindowVisible(cancel) ? IDCANCEL : IDOK;
        HWND button = GetDlgItem(window, target);
        if (IsWindowEnabled(button))
            PostMessageW(window, WM_COMMAND, MAKEWPARAM(target, BN_CLICKED), (LPARAM)button);
        return 0;
    }
    if (message == WM_DRAWITEM && wparam == IDOK && lparam != 0) {
        draw_switch((const DRAWITEMSTRUCT *)lparam);
        return TRUE;
    }
    if (message == WM_NCDESTROY)
        RemoveWindowSubclass(window, parent_proc, id);
    return DefSubclassProc(window, message, wparam, lparam);
}

__declspec(dllexport) void __cdecl Frame(HWND parent, int string_size, WCHAR *variables,
                                        void *stacktop, void *extra)
{
    (void)string_size;
    (void)variables;
    (void)stacktop;
    (void)extra;
    HWND close = GetDlgItem(parent, setup_close);
    RECT client;
    POINT origin = { 0, 0 };
    if (close == NULL || !GetClientRect(parent, &client) || !ClientToScreen(parent, &origin)
        || !SetWindowSubclass(parent, parent_proc, 1, 0))
        return;

    LONG_PTR style = GetWindowLongPtrW(parent, GWL_STYLE);
    SetWindowLongPtrW(parent, GWL_STYLE,
                      style & ~(LONG_PTR)(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX));
    LONG_PTR extended = GetWindowLongPtrW(parent, GWL_EXSTYLE);
    SetWindowLongPtrW(parent, GWL_EXSTYLE,
                      (extended | WS_EX_APPWINDOW) & ~(LONG_PTR)(WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE));
    SetWindowPos(parent, NULL, origin.x, origin.y, client.right, client.bottom,
                 SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    ShowWindow(close, SW_SHOW);
}

static LRESULT CALLBACK button_proc(HWND window, UINT message, WPARAM wparam,
                                    LPARAM lparam, UINT_PTR id, DWORD_PTR data)
{
    if (message == BM_SETSTYLE) {
        SetWindowSubclass(window, button_proc, id, (wparam & BS_TYPEMASK) == BS_DEFPUSHBUTTON);
        wparam = (wparam & ~(WPARAM)BS_TYPEMASK) | BS_OWNERDRAW;
    }
    if (message == WM_GETDLGCODE) {
        LRESULT code = DefSubclassProc(window, message, wparam, lparam);
        code &= ~(LRESULT)(DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON);
        return code | DLGC_BUTTON | (data ? DLGC_DEFPUSHBUTTON : DLGC_UNDEFPUSHBUTTON);
    }
    if (message == WM_NCDESTROY)
        RemoveWindowSubclass(window, button_proc, id);
    return DefSubclassProc(window, message, wparam, lparam);
}

__declspec(dllexport) void __cdecl Apply(HWND parent, int string_size, WCHAR *variables,
                                        void *stacktop, void *extra)
{
    (void)string_size;
    (void)variables;
    (void)stacktop;
    (void)extra;
    HWND button = GetDlgItem(parent, IDOK);
    DWORD_PTR data;
    if (button == NULL || !GetWindowSubclass(parent, parent_proc, 1, &data))
        return;
    LONG_PTR style = GetWindowLongPtrW(button, GWL_STYLE);
    if (!SetWindowSubclass(button, button_proc, 1, (style & BS_TYPEMASK) == BS_DEFPUSHBUTTON)) {
        return;
    }

    SetWindowLongPtrW(button, GWL_STYLE, (style & ~(LONG_PTR)BS_TYPEMASK) | BS_OWNERDRAW);
    InvalidateRect(button, NULL, TRUE);
}

typedef struct PhotoState {
    HBITMAP image;
    BITMAP dimensions;
    DWORD started;
} PhotoState;

static void draw_photo(HWND window, HDC dc, const PhotoState *photo, double reveal)
{
    RECT area;
    GetClientRect(window, &area);
    fill(dc, &area, RGB(11, 19, 15));
    if (reveal == 0) return;

    int width = area.right - area.left;
    int height = area.bottom - area.top;
    int source_width = photo->dimensions.bmWidth;
    int source_height = photo->dimensions.bmHeight;
    if (width <= 0 || height <= 0 || source_width <= 0 || source_height <= 0) return;
    int crop_width = source_width;
    int crop_height = source_height;
    if (source_width * height > width * source_height)
        crop_width = width * source_height / height;
    else
        crop_height = height * source_width / width;

    HDC image_dc = CreateCompatibleDC(dc);
    if (image_dc == NULL) return;
    HGDIOBJ before = SelectObject(image_dc, photo->image);
    int saved = SaveDC(dc);
    if (saved != 0 && before != NULL) {
        IntersectClipRect(dc, area.left, area.top, area.left + (int)(width * reveal), area.bottom);
        SetStretchBltMode(dc, HALFTONE);
        StretchBlt(dc, area.left, area.top, width, height, image_dc,
                   (source_width - crop_width) / 2, (source_height - crop_height) / 2,
                   crop_width, crop_height, SRCCOPY);
    }
    if (saved != 0) RestoreDC(dc, saved);
    if (before != NULL) SelectObject(image_dc, before);
    DeleteDC(image_dc);
}

static LRESULT CALLBACK photo_proc(HWND window, UINT message, WPARAM wparam,
                                  LPARAM lparam, UINT_PTR id, DWORD_PTR data)
{
    PhotoState *photo = (PhotoState *)data;
    if (message == WM_TIMER && wparam == id) {
        InvalidateRect(window, NULL, FALSE);
        return 0;
    }
    if (message == WM_ERASEBKGND) return 1;
    if (message == WM_PAINT) {
        double reveal = 1;
        if (photo->started != 0) {
            DWORD elapsed = GetTickCount() - photo->started;
            if (elapsed < 880) {
                double t = elapsed <= 160 ? 0 : (elapsed - 160) / 720.0;
                reveal = t * t * (3 - 2 * t);
            } else {
                KillTimer(window, id);
                photo->started = 0;
            }
        }
        PAINTSTRUCT paint;
        HDC dc = BeginPaint(window, &paint);
        draw_photo(window, dc, photo, reveal);
        EndPaint(window, &paint);
        return 0;
    }
    if (message == WM_NCDESTROY) {
        KillTimer(window, id);
        RemoveWindowSubclass(window, photo_proc, id);
        DeleteObject(photo->image);
        HeapFree(GetProcessHeap(), 0, photo);
    }
    return DefSubclassProc(window, message, wparam, lparam);
}

typedef struct StackItem {
    struct StackItem *next;
    WCHAR text[1];
} StackItem;

__declspec(dllexport) void __cdecl Animate(HWND parent, int string_size, WCHAR *variables,
                                          StackItem **stack, void *extra)
{
    (void)parent;
    (void)string_size;
    (void)variables;
    (void)extra;
    if (stack == NULL || *stack == NULL || (*stack)->next == NULL) return;
    StackItem *control = *stack;
    StackItem *path = control->next;
    *stack = path->next;
    HWND panel = (HWND)(UINT_PTR)wcstoul(control->text, NULL, 0);
    HBITMAP bitmap = IsWindow(panel)
        ? LoadImageW(NULL, path->text, IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE | LR_CREATEDIBSECTION)
        : NULL;
    GlobalFree(path);
    GlobalFree(control);
    if (bitmap == NULL) return;

    PhotoState *photo = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*photo));
    if (photo == NULL) {
        DeleteObject(bitmap);
        return;
    }
    photo->image = bitmap;
    if (!GetObjectW(bitmap, sizeof(photo->dimensions), &photo->dimensions)
        || !SetWindowSubclass(panel, photo_proc, 1, (DWORD_PTR)photo)) {
        DeleteObject(bitmap);
        HeapFree(GetProcessHeap(), 0, photo);
        return;
    }

    BOOL animation = TRUE;
    SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &animation, 0);
    if (animation && SetTimer(panel, 1, 16, NULL))
        photo->started = GetTickCount();
    InvalidateRect(panel, NULL, FALSE);
}
