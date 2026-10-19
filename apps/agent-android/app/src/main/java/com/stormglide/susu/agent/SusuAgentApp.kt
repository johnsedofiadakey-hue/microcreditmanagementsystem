package com.stormglide.susu.agent

import android.app.Application
import android.content.Intent
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.PersistentCacheSettings
import com.stormglide.susu.agent.data.AuthRepository
import com.stormglide.susu.agent.data.CommandQueue
import com.stormglide.susu.agent.data.DataStoreRefusedWriteStore
import com.stormglide.susu.agent.data.DeviceStore
import com.stormglide.susu.agent.data.EnrollmentRepository
import com.stormglide.susu.agent.data.RouteRepository
import com.stormglide.susu.agent.security.AppLock
import com.stormglide.susu.agent.security.DeviceIdentity
import com.stormglide.susu.agent.security.KeystoreDeviceKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.tasks.await
import kotlin.system.exitProcess

/** Wires Firebase once per process. Debug builds talk to the local Emulator Suite. */
class SusuAgentApp : Application() {

    lateinit var auth: AuthRepository
        private set
    lateinit var commands: CommandQueue
        private set
    lateinit var routes: RouteRepository
        private set
    lateinit var device: DeviceStore
        private set
    /** deviceId + the Keystore key that signs every command (API.md §3, §3a). */
    lateinit var identity: DeviceIdentity
        private set
    lateinit var enrollment: EnrollmentRepository
        private set

    /** Biometric / screen-lock gate in front of every signed-in screen. Locked on each cold start. */
    val lock = AppLock()

    /** Work that must finish even if the screen that started it goes away (e.g. saving a refused write). */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private lateinit var firestore: FirebaseFirestore

    override fun onCreate() {
        super.onCreate()

        val options = FirebaseOptions.Builder()
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .build()
        val app = FirebaseApp.initializeApp(this, options)

        if (!BuildConfig.USE_EMULATORS) {
            FirebaseAppCheck.getInstance(app).installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
        }

        val firebaseAuth = FirebaseAuth.getInstance(app)
        firestore = FirebaseFirestore.getInstance(app)
        if (BuildConfig.USE_EMULATORS) {
            firebaseAuth.useEmulator(BuildConfig.EMULATOR_HOST, 9099)
            firestore.useEmulator(BuildConfig.EMULATOR_HOST, 8080)
        }
        // The persistent cache *is* the offline queue. Never set it to memory-only.
        firestore.firestoreSettings = FirebaseFirestoreSettings.Builder()
            .setLocalCacheSettings(PersistentCacheSettings.newBuilder().setSizeBytes(100L * 1024 * 1024).build())
            .build()
        // A sign-out that died before its wipe finished: finish it before anything reads the cache.
        if (wipePrefs().getBoolean(KEY_WIPE_PENDING, false)) {
            firebaseAuth.signOut()
            firestore.clearPersistence().addOnSuccessListener { wipePrefs().edit().remove(KEY_WIPE_PENDING).apply() }
        }

        auth = AuthRepository(firebaseAuth)
        commands = CommandQueue(firestore, DataStoreRefusedWriteStore(this), appScope)
        routes = RouteRepository(firestore)
        device = DeviceStore(this)
        identity = DeviceIdentity(device, KeystoreDeviceKey())
        enrollment = EnrollmentRepository(firestore, device, identity)
    }

    /**
     * Sign out and remove everything Firestore cached on this phone (member names, amounts, route), then
     * start a fresh process. The caller has already checked that no record is still waiting to sync.
     * Device identity and `lastSeq` live in DataStore, not the cache, so they are kept and never reused.
     */
    suspend fun signOutAndWipe() {
        // Flag first: if the process dies part-way, onCreate finishes the wipe on the next start.
        wipePrefs().edit().putBoolean(KEY_WIPE_PENDING, true).commit()
        auth.signOut()
        try {
            firestore.terminate().await()
            firestore.clearPersistence().await()
            wipePrefs().edit().remove(KEY_WIPE_PENDING).commit()
        } catch (e: Exception) {
            Log.w(TAG, "Cache wipe did not finish; it will be retried on the next start", e)
        }
        restartProcess()
    }

    private fun restartProcess() {
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.component
        if (launch != null) startActivity(Intent.makeRestartActivityTask(launch))
        exitProcess(0)
    }

    private fun wipePrefs() = getSharedPreferences("cache_wipe", MODE_PRIVATE)

    private companion object {
        const val TAG = "SusuAgentApp"
        const val KEY_WIPE_PENDING = "wipePending"
    }
}
