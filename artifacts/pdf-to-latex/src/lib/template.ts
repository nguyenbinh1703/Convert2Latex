export const LATEX_TEMPLATE = `\\documentclass[12pt,a4paper,twoside]{article}
\\usepackage[top=1.5cm, bottom=2cm, left=1.5cm, right=1cm]{geometry}
\\renewcommand{\\baselinestretch}{1.25}

% Gói chính
\\usepackage{amssymb, mathtools, thmtools, xcolor, nameref}
\\usepackage[hidelinks,unicode]{hyperref}

% Gói bổ sung
\\usepackage{mathrsfs, fontawesome5, fancyhdr, enumitem, multirow, makecell, esvect, titlesec, array, bm}
\\usepackage[most]{tcolorbox}

% Gói vẽ hình
\\usepackage{graphicx, pgfplots, tkz-euclide, tikz-3dplot, tikz, tkz-tab, venndiagram}
\\usetikzlibrary{calc, angles, intersections, quotes, arrows.meta, decorations.pathmorphing, patterns.meta, shadings, backgrounds, shapes.geometric, decorations.text, decorations.markings}
\\pgfplotsset{compat=1.9}
\\usepgfplotslibrary{fillbetween}

% Hệ hoặc; hệ và
\\newcommand{\\hehoac}[1]{
        \\left[\\begin{aligned}#1\\end{aligned}\\right.}
\\newcommand{\\heva}[1]{
        \\left\\{\\begin{aligned}#1\\end{aligned}\\right.}

% Header/Footer
\\fancyhf{}
\\pagestyle{fancy}
\\fancyfoot[RO]{\\textbf{Trang \\thepage/\\pageref{sotrang}}}
\\fancyfoot[LO]{\\textbf{Nguyễn Trọng Bình - \\,\\faPhoneSquare\\,0384470445}}
\\fancyfoot[LE]{\\textbf{Trang \\thepage/\\pageref{sotrang}}}
\\fancyfoot[RE]{\\textbf{Nguyễn Trọng Bình - \\,\\faPhoneSquare\\,0384470445}}

% Độ dày đường kẻ footer/header
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0.4pt}

% Khoảng cách header/footer
\\setlength{\\headheight}{1pt}
\\setlength{\\footskip}{45pt}

% Môi trường trắc nghiệm
\\usepackage[dethi]{ex_test}
%\\usepackage[color]{ex_test}
%\\usepackage[loigiai]{ex_test}
%\\usepackage[solcolor]{ex_test}
%\\usepackage[book]{ex_test}

% Môi trường tự luận
\\newtheorem{bt}[ex]{\\color{blue}\\textbf{Câu}}

% Tuỳ chỉnh môi trường đề thi
\\renewcommand{\\nameex}{\\color{blue}\\bf Câu}
\\renewcommand{\\loigiaiEX}{\\textbf{\\centerline{Lời giải}}}
\\renewcommand{\\FalseEX}{\\stepcounter{dapan}{\\textbf{\\color{blue}\\Alph{dapan}.}}}
\\renewcommand{\\FalseTF}{\\stepcounter{dapan}\\textbf{\\color{blue}\\DapAnTF\\sepTF}}

% Thay lời giải bằng hàng dấu chấm
%\\dotlineans{5}{ex}
%\\dotlinefull{ex}
%\\dotlineans{5}{bt}
%\\dotlinefull{bt}

% Tạo biến đếm cho câu hỏi
\\usepackage{etoolbox}
\\newcounter{demEX}
\\newcounter{demBT}
\\newif\\ifCounting % Cờ cho biến đếm

\\AtBeginEnvironment{ex}{
        \\ifCounting
        \\stepcounter{demEX}
        \\fi} % Chỉ đếm khi cờ được bật
\\AtBeginEnvironment{bt}{
        \\ifCounting
        \\stepcounter{demBT}
        \\fi} % Chỉ đếm khi cờ được bật

% Khu vực đếm EX
\\newenvironment{kvdemEX}[1]
{% Bắt đầu môi trường
        \\def\\nhanEX{#1}
        \\setcounter{demEX}{0}
        \\Countingtrue
}
{% Kết thúc môi trường
        \\Countingfalse
        \\setcounter{demEX}{\\value{demEX}-1}
        \\refstepcounter{demEX}
        \\label{\\nhanEX}}

% Khu vực đếm BT
\\newenvironment{kvdemBT}[1]
{% Bắt đầu môi trường
        \\def\\nhanBT{#1}
        \\setcounter{demBT}{0}
        \\Countingtrue
}
{% Kết thúc môi trường
        \\Countingfalse
        \\setcounter{demBT}{\\value{demBT}-1}
        \\refstepcounter{demBT}
        \\label{\\nhanBT}
}

% Tiêu đề
\\newcommand{\\mybox}[1]{\\tcbox[tikznode,enhanced,frame empty,borderline={0.2mm}{0mm}{dashed},arc=5mm,halign=center]{#1}}
\\newcommand{\\tieude}{
        \\begin{tcolorbox}[arc=8mm,boxrule=1pt,halign=center]
                {\\bfseries\\tende}\\\\
                {\\bfseries\\thongtin}\\vspace{0.2cm}\\\\
                \\makebox[\\linewidth][c]{
                        \\mybox{
                                \\textbf{Hướng dẫn}\\\\
                                \\textbf{Nguyễn Trọng Bình}
                        }
                        \\hfill
                        \\mybox{
                                \\textbf{Thời gian: \\thoigian}\\\\
                                (Không kể thời gian phát đề)
                        }
                        \\hfill
                        \\mybox{
                                \\textbf{Đề số: \\made}\\\\
                                \\textbf{(Đề có \\pageref{sotrang} trang)}
                        }
                }
        \\end{tcolorbox}
}

% Thông số tiêu đề của đề thi
\\def\\tende{ĐỀ MINH HOẠ}
\\def\\thongtin{(\\ref{tn} câu trắc nghiệm, \\ref{ds} câu đúng/sai, \\ref{tln} câu trả lời ngắn, \\ref{tl} câu tự luận)}
\\def\\made{01}
\\def\\thoigian{90 phút}

\\begin{document}
        \\tieude
        \\setlength{\\parindent}{0pt}
        
        \\begin{kvdemEX}{tn}
                \\Opensolutionfile{ans}[ans/tn]
                % Nội dung các câu hỏi trắc nghiệm lựa chọn
                \\Closesolutionfile{ans}
        \\end{kvdemEX}
        
        \\begin{kvdemEX}{ds}
                \\Opensolutionfile{ans}[ans/ds]
                % Nội dung các câu hỏi trắc nghiệm đúng sai
                \\Closesolutionfile{ans}
        \\end{kvdemEX}
        
        \\begin{kvdemEX}{tln}
                \\Opensolutionfile{ans}[ans/tln]
                % Nội dung các câu hỏi trắc nghiệm trả lời ngắn         
                \\Closesolutionfile{ans}
        \\end{kvdemEX}
        
        \\begin{kvdemBT}{tl}
                % Nội dung các câu hỏi tự luận
        \\end{kvdemBT}
        
        \\label{sotrang}
        \\centering{\\rule[0.5ex]{2cm}{1pt} \\textbf{HẾT} \\rule[0.5ex]{2cm}{1pt}}
        
\\end{document}`;
