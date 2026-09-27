Pod::Spec.new do |s|
  s.name           = 'WidgetStorage'
  s.version        = '1.0.0'
  s.summary        = 'App Group storage shared with the Daily Tasks widget'
  s.description    = 'Reads and writes App Group UserDefaults and reloads WidgetKit timelines.'
  s.author         = ''
  s.homepage       = 'https://github.com/faisal1024/daily-tasks'
  # Matches the app's minimum; WidgetKit calls are guarded with #available.
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,swift}"
end
