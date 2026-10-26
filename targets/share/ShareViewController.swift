// "Three Today" in the share sheet (1.6 E): share text or a link from any
// app and it's saved for later. Nothing opens; the next time the app opens
// it moves each capture to Ideas → Saved for later (never onto today's
// three) and says so. See lib/daily-tasks/capture.ts.
//
// The system compose sheet: the shared text (or a page's title) is shown and
// can be edited; a shared link is added after it.

import Social
import UIKit
import UniformTypeIdentifiers

class ShareViewController: SLComposeServiceViewController {
  private var sharedURL: URL?

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Three Today"
    placeholder = "A thought to save for later"
    loadSharedURL()
  }

  override func presentationAnimationDidFinish() {
    super.presentationAnimationDidFinish()
    navigationController?.navigationBar.topItem?.rightBarButtonItem?.title = "Save"
  }

  override func isContentValid() -> Bool {
    let text = (contentText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return !text.isEmpty || sharedURL != nil
  }

  override func didSelectPost() {
    CaptureGroup.append(Self.compose(text: contentText, url: sharedURL), source: "share")
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }

  override func configurationItems() -> [Any]! { [] }

  /// The text, then the link (unless the text already has it).
  static func compose(text: String?, url: URL?) -> String {
    let body = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard let link = url?.absoluteString, !link.isEmpty, !body.contains(link) else { return body }
    return body.isEmpty ? link : "\(body) \(link)"
  }

  /// The first web link shared, if any (Safari shares the page's title as
  /// text plus its URL).
  private func loadSharedURL() {
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    let providers = items.flatMap { $0.attachments ?? [] }
    let urlType = UTType.url.identifier
    guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(urlType) }) else { return }
    provider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] item, _ in
      var url: URL?
      if let value = item as? URL {
        url = value
      } else if let value = item as? String {
        url = URL(string: value)
      } else if let value = item as? Data {
        url = URL(dataRepresentation: value, relativeTo: nil)
      }
      guard let url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
      DispatchQueue.main.async {
        self?.sharedURL = url
        self?.validateContent()
      }
    }
  }
}
