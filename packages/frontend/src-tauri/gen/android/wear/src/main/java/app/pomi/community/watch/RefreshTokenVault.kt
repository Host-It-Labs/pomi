package app.pomi.community.watch

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal interface RefreshTokenVault {
    fun read(): String?
    fun write(value: String)
    fun delete()
}

internal class AndroidKeystoreRefreshTokenVault(context: Context) : RefreshTokenVault {
    private val preferences = context.applicationContext.getSharedPreferences(
        "pomi_watch_secure",
        Context.MODE_PRIVATE
    )

    override fun read(): String? {
        val encodedIv = preferences.getString(KEY_IV, null) ?: return null
        val encodedCiphertext = preferences.getString(KEY_CIPHERTEXT, null) ?: return null
        return try {
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
        } catch (_: Exception) {
            delete()
            null
        }
    }

    override fun write(value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(
                KEY_CIPHERTEXT,
                Base64.encodeToString(ciphertext, Base64.NO_WRAP)
            )
            .apply()
    }

    override fun delete() {
        preferences.edit().remove(KEY_IV).remove(KEY_CIPHERTEXT).apply()
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
        const val KEY_ALIAS = "pomi_watch_refresh_session_v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_IV = "refresh_iv"
        const val KEY_CIPHERTEXT = "refresh_ciphertext"
    }
}
