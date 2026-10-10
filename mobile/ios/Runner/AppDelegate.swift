import Flutter
import UIKit
import PushKit
import flutter_callkit_incoming

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // ── VoIP push (iOS production call receiving) ──────────────────────
    // PushKit registers the VoIP token; APNs delivers the backend's
    // `apns-push-type: voip` pushes here even when the app is suspended
    // or terminated. Apple (iOS 13+) requires every VoIP push to be
    // reported to CallKit — the plugin's `showCallkitIncoming(fromPushKit:
    // true)` does exactly that, showing the native incoming-call screen
    // with the caller's name/avatar from the push payload.
    //
    // The signaling offer itself is re-delivered by the SERVER when the
    // app's /ws-call socket reconnects + re-registers (see
    // src/audio_call/handler.rs `re_deliver_missed_offer_to`), so the
    // Dart side can accept the call the moment CallKit's Accept fires.
    self.registerPushKit()

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }

  // MARK: - PushKit (VoIP)

  private func registerPushKit() {
    let registry = PKPushRegistry(queue: DispatchQueue.main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
  }
}

extension AppDelegate: PKPushRegistryDelegate {
  func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate credentials: PKPushCredentials,
    for type: PKPushType
  ) {
    // The VoIP device token — the Dart side reads it via
    // `FlutterCallkitIncoming.getDevicePushTokenVoIP()` (the plugin
    // caches it) and registers it with the backend, which uses it as
    // the APNs push target for call wake-ups.
    let deviceToken = credentials.token.map { String(format: "%02x", $0) }.joined()
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.setDevicePushTokenVoIP(deviceToken)
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didInvalidatePushTokenFor type: PKPushType
  ) {
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.setDevicePushTokenVoIP("")
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: [AnyHashable: Any],
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else {
      completion()
      return
    }
    // The backend's payload IS the plugin's `Data(args:)` map:
    // id / nameCaller / handle / type / avatar / duration / extra
    // (built in src/push/mod.rs `notify_incoming_call`). Reporting it
    // to CallKit here satisfies Apple's iOS 13+ VoIP policy.
    let data = flutter_callkit_incoming.Data(args: payload as NSDictionary)
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.showCallkitIncoming(
      data,
      fromPushKit: true)
    // MUST call completion() — otherwise iOS terminates the app.
    completion()
  }
}
