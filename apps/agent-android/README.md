# Susu Agent (Android)

Kotlin + Jetpack Compose app for field agent pairs. It records collections into the Firestore
offline queue exactly as `docs/contracts/API.md` §3 specifies.

## What is here

| Piece | File |
|---|---|
| Command envelope (7 fields, UUID v4 IDs, ISO `capturedAt`) | `data/Commands.kt` |
| Per-install device ID and persisted per-device `seq` | `data/DeviceStore.kt` |
| Offline queue: write `commands/{uuid}`, listen for Pending sync / Synced / Rejected | `data/CommandQueue.kt` |
| Integer-pesewa money, mirror of `@susu/shared` `formatCedis`/`parseCedis` | `data/Cedis.kt` |
| Today's route read model (`agentPairs/{id}/routes/{day}`), sample rows in debug until Step 4 | `data/RouteRepository.kt` |
| Sign-in and claim checks (role `AGENT` + `agentPairId`) | `data/AuthRepository.kt` |
| Screens: sign-in, route, collection keypad, records, this phone (sign-out blocked while unsynced) | `ui/` |

## Build

Needs JDK 17+ and the Android SDK (platform `android-37.0`, build-tools 37). AGP 9.4 with built-in
Kotlin; the Gradle wrapper (9.8.1) is included.

```bash
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

Set `sdk.dir` in `local.properties` (or `ANDROID_HOME`).

## Run against the emulators

Debug builds point at the Firebase Emulator Suite on the host (`10.0.2.2`), project `demo-susu`.
From the repo root: `firebase emulators:start --project demo-susu`, create an agent and a pair in the
portal, sign in on the phone, copy the device ID from **Phone**, and bind it in the portal under **Devices**.

## Rules the app keeps

- One fresh UUID v4 per action, fixed when the collection screen opens; saving twice can't duplicate.
- `seq` is reserved and written to disk before use, never reused.
- A collection shows **Pending sync** until the server writes `status: POSTED`.
- The app never updates or deletes a command and never writes status fields.
- Sign-out is blocked while any record is still only on this phone.
- Device ID and queue data are excluded from Android backup and device transfer.
