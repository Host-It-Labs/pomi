package app.pomi.community

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class AndroidRefreshTokenVault(context: Context, account: String) {
    private val storageKey = java.security.MessageDigest.getInstance("SHA-256")
        .digest(account.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
    private val ivKey = "${storageKey}_iv"
    private val ciphertextKey = "${storageKey}_ciphertext"
    private val preferences = context.applicationContext.getSharedPreferences(
        "pomi_android_secure",
        Context.MODE_PRIVATE
    )

    fun read(): String? {
        val encodedIv = preferences.getString(ivKey, null)
        val encodedCiphertext = preferences.getString(ciphertextKey, null)
        if (encodedIv == null && encodedCiphertext == null) return null
        check(encodedIv != null && encodedCiphertext != null) { "Incomplete refresh session" }
        return run {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                encryptionKey(),
                GCMParameterSpec(128, Base64.decode(encodedIv, Base64.NO_WRAP))
            )
            String(
                cipher.doFinal(Base64.decode(encodedCiphertext, Base64.NO_WRAP)),
                Charsets.UTF_8
            )
        }
    }

    fun write(value: String) {
        require(value.isNotBlank()) { "Missing refresh session" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(ivKey, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(
                ciphertextKey,
                Base64.encodeToString(ciphertext, Base64.NO_WRAP)
            )
            .commit().also { check(it) { "Unable to persist refresh session" } }
    }

    fun delete() {
        check(preferences.edit().remove(ivKey).remove(ciphertextKey).commit()) {
            "Unable to delete refresh session"
        }
    }

    private fun encryptionKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setRandomizedEncryptionRequired(true)
                        .build()
                )
            }
            .generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "pomi_android_refresh_session_v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
