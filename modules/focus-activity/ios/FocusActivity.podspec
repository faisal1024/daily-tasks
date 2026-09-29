Pod::Spec.new do |s|
  s.name           = 'FocusActivity'
  s.version        = '1.0.0'
  s.summary        = 'The focus session Live Activity for Three Today'
  s.description    = 'Starts, updates and ends the focus session Live Activity (ActivityKit).'
  s.author         = ''
  s.homepage       = 'https://github.com/faisal1024/daily-tasks'
  # Matches the app's minimum; ActivityKit calls are guarded with #available
  # and the framework is weak-linked, so iOS 15 simply has no Live Activity.
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.weak_frameworks = 'ActivityKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,swift}"
end
