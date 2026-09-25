import { HttpError } from "./http";

export function outlookManifest(
  template: string,
  originValue: string,
  addinId: string,
) {
  const origin = new URL(originValue);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      addinId,
    )
  )
    throw new HttpError("Use an HTTPS origin and a stable add-in GUID.", 400);
  if (!template.includes("__ORIGIN__") || !template.includes("__ADDIN_ID__"))
    throw new HttpError("Manifest template is invalid.", 400);
  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return template
    .replaceAll("__ORIGIN__", escape(origin.origin))
    .replaceAll("__ADDIN_ID__", addinId.toLowerCase());
}
export function outlookFraming(enabled: boolean) {
  return enabled
    ? [
        {
          key: "Content-Security-Policy",
          value:
            "frame-ancestors 'self' https://outlook.office.com https://outlook.office365.com https://outlook.live.com",
        },
      ]
    : [{ key: "X-Frame-Options", value: "DENY" }];
}
