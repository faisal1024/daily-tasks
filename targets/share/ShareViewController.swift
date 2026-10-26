// "Three Today" in the share sheet (1.6 E): share text or a link from any
// app and it's saved for later. Nothing opens; the next time the app opens
// it moves each capture to Saved for later (never onto today's three) and
// says so. See lib/daily-tasks/capture.ts.
//
// The system compose sheet shows exactly what will be saved: the shared text
// (or a page's title), then the shared link, all editable. Save stays off
// until everything shared has loaded. If the capture can't be saved (the
// inbox is full, or the App Group can't be written) it says so instead of
// closing as if it had worked.

import Social
import UIKit
import UniformTypeIdentifiers

class ShareViewController: SLComposeServiceViewController {
  /// Attachments still loading: Save is off until it's 0.
  private var loading = 0
  private var loadedText: String?
  private var loadedURL: URL?
  private static let saveTitle = "Save"

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Three Today"
    placeholder = "Save for later in Three Today"
    loadAttachments()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    renameSaveButton()
  }

  override func presentationAnimationDidFinish() {
    super.presentationAnimationDidFinish()
    renameSaveButton()
  }

  private func renameSaveButton() {
    navigationController?.navigationBar.topItem?.rightBarButtonItem?.title = Self.saveTitle
  }

  override func isContentValid() -> Bool {
    guard loading == 0 else { return false }
    return !(contentText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  override func didSelectPost() {
    switch CaptureGroup.append(contentText ?? "", source: "share") {
    case .saved, .empty:
      extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    case .full:
      tellAndClose(
        "Saved for later is full",
        "Your saved-for-later inbox is full. Open Three Today to sort it, then share this again."
      )
    case .failed:
      tellAndClose("Couldn't save that", "Three Today couldn't save this. Please try again.")
    }
  }

  override func configurationItems() -> [Any]! { [] }

  private func tellAndClose(_ title: String, _ message: String) {
    let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
    alert.addAction(
      UIAlertAction(title: "OK", style: .default) { [weak self] _ in
        let error = NSError(domain: "com.faisalislam.dailytasks.share", code: 1)
        self?.extensionContext?.cancelRequest(withError: error)
      })
    present(alert, animated: true)
  }

  /// The shared text and the first web link, whichever the app offers.
  private func loadAttachments() {
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    let providers = items.flatMap { $0.attachments ?? [] }
    let urlType = UTType.url.identifier
    let textType = UTType.plainText.identifier
    for provider in providers {
      if provider.hasItemConformingToTypeIdentifier(urlType) {
        loading += 1
        provider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] item, _ in
          let url = Self.webURL(from: item)
          DispatchQueue.main.async { self?.loaded(url: url) }
        }
      } else if provider.hasItemConformingToTypeIdentifier(textType) {
        loading += 1
        provider.loadItem(forTypeIdentifier: textType, options: nil) { [weak self] item, _ in
          let text = Self.text(from: item)
          DispatchQueue.main.async { self?.loaded(text: text) }
        }
      }
    }
    if loading == 0 { showLoaded() }
  }

  private func loaded(url: URL? = nil, text: String? = nil) {
    if loadedURL == nil { loadedURL = url }
    if loadedText == nil, let text, !text.isEmpty { loadedText = text }
    loading = max(0, loading - 1)
    if loading == 0 { showLoaded() }
  }

  /// What will be saved, in the text box: the shared text (or the page's
  /// title, which the sheet fills in itself), then the link.
  private func showLoaded() {
    textView.text = Self.compose(text: textView.text, loadedText: loadedText, url: loadedURL)
    validateContent()
  }

  static func compose(text: String?, loadedText: String?, url: URL?) -> String {
    var body = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if body.isEmpty { body = (loadedText ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    guard let link = url?.absoluteString, !link.isEmpty, !body.contains(link) else { return body }
    return body.isEmpty ? link : "\(body)\n\(link)"
  }

  static func webURL(from item: NSSecureCoding?) -> URL? {
    var url: URL?
    if let value = item as? URL {
      url = value
    } else if let value = item as? String {
      url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines))
    } else if let value = item as? Data {
      url = URL(dataRepresentation: value, relativeTo: nil)
    }
    guard let url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
    return url
  }

  static func text(from item: NSSecureCoding?) -> String? {
    if let value = item as? String { return value }
    if let value = item as? NSAttributedString { return value.string }
    if let value = item as? Data { return String(data: value, encoding: .utf8) }
    return nil
  }
}
