package app.pomi.community

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class RefreshVaultArgs {
    lateinit var account: String
    var value: String? = null
}

@TauriPlugin
class RefreshVaultPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun read(invoke: Invoke) = execute(invoke) { vault, _ ->
        JSObject().put("value", vault.read())
    }

    @Command
    fun write(invoke: Invoke) = execute(invoke) { vault, args ->
        vault.write(requireNotNull(args.value) { "Missing refresh session" })
        JSObject()
    }

    @Command
    fun delete(invoke: Invoke) = execute(invoke) { vault, _ ->
        vault.delete()
        JSObject()
    }

    private fun execute(
        invoke: Invoke,
        operation: (AndroidRefreshTokenVault, RefreshVaultArgs) -> JSObject
    ) {
        try {
            val args = invoke.parseArgs(RefreshVaultArgs::class.java)
            require(args.account.isNotBlank()) { "Missing backend origin" }
            invoke.resolve(operation(AndroidRefreshTokenVault(activity, args.account), args))
        } catch (error: Exception) {
            invoke.reject("Secure session storage unavailable")
        }
    }
}
