{{-- The page furniture: the page number and the footer artwork.

     Both are position:fixed, so Dompdf paints them on every page. One copy per
     document — never one per invoice.

     Expects: $pageNumberTop (via the stylesheet), $footerImage --}}
{{-- Page number: 1, 2, 3 … in the top right of every page. Fixed, so Dompdf
     repeats it, and driven by counter(page) so it always matches the page it
     is printed on. --}}
<div class="page-number"></div>

{{-- Footer artwork: the angled bars and the company's contact strip. --}}
<div class="footer">
    @if ($footerImage)
        <img class="footer-art" src="{{ $footerImage }}" alt="">
    @else
        <div class="footer-fallback"><div class="bar"></div></div>
    @endif
</div>
