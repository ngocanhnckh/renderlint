<?php
// Elementor test pages for e2e/wordpress/run.mjs: "studio" is built well, "beratung" has typical mistakes.
$ids = [];
foreach (['team.png' => [800, 600, [99, 102, 241]], 'office.png' => [1200, 700, [14, 116, 144]], 'avatar.png' => [240, 240, [244, 114, 182]]] as $f => [$iw, $ih, $rgb]) {
  $existing = get_posts(['post_type'=>'attachment','title'=>$f,'numberposts'=>1]);
  if ($existing) { $ids[$f] = $existing[0]->ID; continue; }
  require_once ABSPATH.'wp-admin/includes/media.php'; require_once ABSPATH.'wp-admin/includes/file.php'; require_once ABSPATH.'wp-admin/includes/image.php';
  $tmp = wp_tempnam($f); $im = imagecreatetruecolor($iw, $ih); imagefill($im, 0, 0, imagecolorallocate($im, ...$rgb)); imagepng($im, $tmp);
  $ids[$f] = media_handle_sideload(['name'=>$f,'tmp_name'=>$tmp], 0, $f);
}
$img = fn($f) => ['id'=>$ids[$f], 'url'=>wp_get_attachment_url($ids[$f])];
$n = 0; $id = function() use (&$n) { $n++; return substr(md5('rl'.$n), 0, 7); };
$c = fn($settings, $elements) => ['id'=>$id(), 'elType'=>'container', 'isInner'=>false, 'settings'=>$settings, 'elements'=>$elements];
$w = fn($type, $settings) => ['id'=>$id(), 'elType'=>'widget', 'widgetType'=>$type, 'settings'=>$settings, 'elements'=>[]];
$px = fn($s) => ['unit'=>'px','size'=>$s,'sizes'=>[]];
$pad = fn($t,$r,$b,$l) => ['unit'=>'px','top'=>"$t",'right'=>"$r",'bottom'=>"$b",'left'=>"$l",'isLinked'=>false];
$font = fn($size, $mobile=null, $weight='700') => array_filter(['typography_typography'=>'custom','typography_font_size'=>$px($size),'typography_font_size_mobile'=>$mobile?$px($mobile):null,'typography_font_weight'=>$weight]);
$row = ['flex_direction'=>'row','flex_direction_mobile'=>'column','flex_wrap'=>'wrap','flex_gap'=>['unit'=>'px','size'=>24,'column'=>'24','row'=>'24','isLinked'=>true]];

function make_page($title, $slug, $data) {
  $p = get_page_by_path($slug);
  $pid = $p ? $p->ID : wp_insert_post(['post_type'=>'page','post_status'=>'publish','post_title'=>$title,'post_name'=>$slug]);
  update_post_meta($pid, '_elementor_edit_mode', 'builder');
  update_post_meta($pid, '_elementor_template_type', 'wp-page');
  update_post_meta($pid, '_elementor_version', ELEMENTOR_VERSION);
  update_post_meta($pid, '_wp_page_template', 'elementor_header_footer');
  update_post_meta($pid, '_elementor_data', wp_slash(wp_json_encode($data)));
  \Elementor\Plugin::$instance->files_manager->clear_cache();
  echo "$slug: $pid\n";
  return $pid;
}

// ---------- A well-built Elementor landing page ----------
$clean = [
  $c(['content_width'=>'boxed','background_background'=>'classic','background_color'=>'#0F172A','padding'=>$pad(96,24,96,24),'flex_gap'=>$px(20)], [
    $w('heading', ['title'=>'Design systems for teams that ship weekly','header_size'=>'h1','title_color'=>'#FFFFFF'] + $font(56, 34)),
    $w('text-editor', ['editor'=>'<p>Northwind Studio builds and maintains component libraries, documentation and tooling for product teams of 10 to 400 engineers.</p>','text_color'=>'#CBD5E1'] + $font(19, 17, '400')),
    $c(['flex_direction'=>'row','flex_wrap'=>'wrap','flex_gap'=>$px(12),'content_width'=>'full','padding'=>$pad(0,0,0,0)], [
      $w('button', ['text'=>'Book a call','link'=>['url'=>'/contact/'],'background_color'=>'#4F46E5','button_text_color'=>'#FFFFFF','size'=>'md']),
      $w('button', ['text'=>'See our work','link'=>['url'=>'/work/'],'background_color'=>'#FFFFFF','button_text_color'=>'#0F172A','size'=>'md']),
    ]),
  ]),
  $c(['content_width'=>'boxed','padding'=>$pad(80,24,80,24)] + $row, [
    $w('icon-box', ['selected_icon'=>['value'=>'fas fa-layer-group','library'=>'fa-solid'],'title_text'=>'Component libraries','description_text'=>'React, Vue and Web Components, documented in Storybook and versioned with semver.','primary_color'=>'#4F46E5','_flex_size'=>'grow','title_color'=>'#0F172A','description_color'=>'#475569']),
    $w('icon-box', ['selected_icon'=>['value'=>'fas fa-ruler-combined','library'=>'fa-solid'],'title_text'=>'Design tokens','description_text'=>'One source of truth for color, spacing and type across Figma, CSS and native apps.','primary_color'=>'#4F46E5','_flex_size'=>'grow','title_color'=>'#0F172A','description_color'=>'#475569']),
    $w('icon-box', ['selected_icon'=>['value'=>'fas fa-universal-access','library'=>'fa-solid'],'title_text'=>'Accessibility audits','description_text'=>'WCAG 2.2 AA reviews with fixes merged, not a PDF report.','primary_color'=>'#4F46E5','_flex_size'=>'grow','title_color'=>'#0F172A','description_color'=>'#475569']),
  ]),
  $c(['content_width'=>'boxed','background_background'=>'classic','background_color'=>'#F8FAFC','padding'=>$pad(64,24,64,24)] + $row, [
    $w('counter', ['ending_number'=>140,'suffix'=>'+','title'=>'Components shipped','_flex_size'=>'grow','number_color'=>'#0F172A','title_color'=>'#475569']),
    $w('counter', ['ending_number'=>38,'title'=>'Product teams','_flex_size'=>'grow','number_color'=>'#0F172A','title_color'=>'#475569']),
    $w('counter', ['ending_number'=>99,'suffix'=>'%','title'=>'Audit issues closed','_flex_size'=>'grow','number_color'=>'#0F172A','title_color'=>'#475569']),
  ]),
  $c(['content_width'=>'boxed','padding'=>$pad(80,24,80,24)] + $row, [
    $w('image', ['image'=>$img('team.png'),'image_size'=>'large','_flex_size'=>'grow','width'=>['unit'=>'%','size'=>100]]),
    $c(['content_width'=>'full','flex_gap'=>$px(16),'_flex_size'=>'grow','width'=>['unit'=>'%','size'=>48],'width_mobile'=>['unit'=>'%','size'=>100]], [
      $w('heading', ['title'=>'How an engagement works','header_size'=>'h2','title_color'=>'#0F172A'] + $font(36, 28)),
      $w('icon-list', ['icon_list'=>[
        ['_id'=>$id(),'text'=>'Two-week discovery with your designers and engineers','selected_icon'=>['value'=>'fas fa-check','library'=>'fa-solid']],
        ['_id'=>$id(),'text'=>'A token and component roadmap you can review','selected_icon'=>['value'=>'fas fa-check','library'=>'fa-solid']],
        ['_id'=>$id(),'text'=>'Weekly releases into your repository','selected_icon'=>['value'=>'fas fa-check','library'=>'fa-solid']],
      ],'icon_color'=>'#16A34A','text_color'=>'#334155']),
      $w('accordion', ['tabs'=>[
        ['_id'=>$id(),'tab_title'=>'Do you work with our existing design system?','tab_content'=>'<p>Yes. Most clients have one already; we extend it rather than start over.</p>'],
        ['_id'=>$id(),'tab_title'=>'Which frameworks do you support?','tab_content'=>'<p>React, Vue, Angular, Svelte and plain Web Components.</p>'],
      ],'title_color'=>'#0F172A','content_color'=>'#334155']),
    ]),
  ]),
  $c(['content_width'=>'boxed','padding'=>$pad(64,24,64,24)], [
    $w('heading', ['title'=>'What clients say','header_size'=>'h2','title_color'=>'#0F172A','_animation'=>'fadeInUp','align'=>'center'] + $font(32, 26)),
    $w('testimonial', ['testimonial_content'=>'Northwind cut our UI bug backlog in half within a quarter, and our designers finally trust what ships.','testimonial_name'=>'Priya Raman','testimonial_job'=>'VP Engineering, Lumen','testimonial_image'=>$img('avatar.png'),'content_content_color'=>'#334155','name_text_color'=>'#0F172A','job_text_color'=>'#475569']),
  ]),
  $c(['content_width'=>'boxed','background_background'=>'classic','background_color'=>'#4F46E5','padding'=>$pad(64,24,64,24),'flex_gap'=>$px(16),'animation'=>'fadeInUp'], [
    $w('heading', ['title'=>'Ready when you are','header_size'=>'h2','title_color'=>'#FFFFFF','align'=>'center'] + $font(36, 28)),
    $w('button', ['text'=>'Start a project','link'=>['url'=>'/contact/'],'background_color'=>'#FFFFFF','button_text_color'=>'#312E81','align'=>'center']),
    $w('social-icons', ['social_icon_list'=>[
      ['_id'=>$id(),'social_icon'=>['value'=>'fab fa-linkedin','library'=>'fa-brands'],'link'=>['url'=>'https://www.linkedin.com/'],'item_icon_color'=>'custom','item_icon_primary_color'=>'#FFFFFF','item_icon_secondary_color'=>'#312E81'],
      ['_id'=>$id(),'social_icon'=>['value'=>'fab fa-github','library'=>'fa-brands'],'link'=>['url'=>'https://github.com/'],'item_icon_color'=>'custom','item_icon_primary_color'=>'#FFFFFF','item_icon_secondary_color'=>'#312E81'],
    ],'align'=>'center']),
  ]),
];
make_page('Studio', 'studio', $clean);

// ---------- The same kind of page with typical Elementor mistakes ----------
$broken = [
  $c(['content_width'=>'boxed','background_background'=>'classic','background_color'=>'#1E293B','padding'=>$pad(96,24,96,24),'flex_gap'=>$px(20)], [
    // Desktop size only: 76px on phones too, and a long German word that can't wrap.
    $w('heading', ['title'=>'Unternehmensberatung für Designsysteme','header_size'=>'h1','title_color'=>'#FFFFFF'] + $font(76)),
    $w('text-editor', ['editor'=>'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut elit tellus, luctus nec ullamcorper mattis, pulvinar dapibus leo.</p>','text_color'=>'#64748B']),
    $w('button', ['text'=>'Kostenloses Erstgespräch','link'=>['url'=>'#'],'background_color'=>'#FACC15','button_text_color'=>'#FFFFFF']),
  ]),
  $c(['content_width'=>'boxed','padding'=>$pad(80,24,80,24),'flex_direction'=>'row','flex_wrap'=>'nowrap','flex_gap'=>$px(24)], [
    $w('heading', ['title'=>'Add Your Heading Text Here','header_size'=>'h2','title_color'=>'#0F172A','_element_width'=>'initial','_element_custom_width'=>$px(320)]),
    $w('icon-box', ['selected_icon'=>['value'=>'fas fa-star','library'=>'fa-solid'],'title_text'=>'🚀 Schneller live','description_text'=>'Wir liefern jede Woche.','_element_width'=>'initial','_element_custom_width'=>$px(320),'title_color'=>'#0F172A','description_color'=>'#9CA3AF']),
    $w('icon-box', ['selected_icon'=>['value'=>'fas fa-heart','library'=>'fa-solid'],'title_text'=>'Barrierefreiheit','description_text'=>'WCAG 2.2 AA geprüft.','_element_width'=>'initial','_element_custom_width'=>$px(320),'title_color'=>'#0F172A','description_color'=>'#9CA3AF']),
  ]),
  $c(['content_width'=>'boxed','padding'=>$pad(40,24,40,24)] + $row, [
    $w('counter', ['ending_number'=>140,'title'=>'Cool Number','_flex_size'=>'grow']),
    $w('image', ['image'=>$img('office.png'),'image_size'=>'full','width'=>$px(300),'height'=>$px(300),'_flex_size'=>'none']),
  ]),
];
// An entrance animation Elementor never runs: the element stays hidden.
$broken[] = $c(['content_width'=>'boxed','background_background'=>'classic','background_color'=>'#4F46E5','padding'=>$pad(64,24,64,24),'_animation'=>'fadeInUp'], [
  $w('heading', ['title'=>'Jetzt Termin vereinbaren','header_size'=>'h2','title_color'=>'#FFFFFF']),
  $w('text-editor', ['editor'=>'<p>Wir melden uns innerhalb von zwei Werktagen mit einem Terminvorschlag.</p>','text_color'=>'#FFFFFF']),
]);
make_page('Beratung', 'beratung', $broken);
