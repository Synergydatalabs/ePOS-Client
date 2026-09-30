// /login → /signin redirect.
//
// Muscle-memory URLs. Users type /login expecting a login page — this
// route just forwards them to the real one at /signin. Server-side
// redirect so we don't flash a blank page.

import { redirect } from "next/navigation";

export default function LoginRedirect() {
  redirect("/signin");
}
