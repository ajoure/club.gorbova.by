import jsPDF from "jspdf";

export function generatePolicyPdf() {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  // Set font to support Cyrillic
  doc.setFont("helvetica");
  
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let yPosition = 20;
  const lineHeight = 6;

  const addText = (text: string, options?: { bold?: boolean; size?: number; indent?: number }) => {
    const { bold = false, size = 10, indent = 0 } = options || {};
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    
    const lines = doc.splitTextToSize(text, contentWidth - indent);
    lines.forEach((line: string) => {
      if (yPosition > 270) {
        doc.addPage();
        yPosition = 20;
      }
      doc.text(line, margin + indent, yPosition);
      yPosition += lineHeight;
    });
  };

  const addSpace = (height: number = 4) => {
    yPosition += height;
  };

  // Title
  addText("SOGLASIE NA OBRABOTKU PERSONALNYH DANNYH", { bold: true, size: 14 });
  addText("NA SAJTE V INTERNETE", { bold: true, size: 14 });
  addSpace(8);

  // Operator details
  addText("Operator personalnyh dannyh:", { bold: true, size: 11 });
  addSpace(2);
  addText("Zakrytoe akcionernoe obshestvo AJUR inkam");
  addText("UNP 193405000");
  addText("220035, g. Minsk, ul. Panfilova, 2, ofis 49L");
  addText("Pochtovyj adres: 220052, Respublika Belarus, g. Minsk, a/ja 63");
  addText("Telefon: +375 29 171-43-21");
  addText("Email: info@ajoure.by");
  addText("Direktor: Kovrizhkin Aleksej Igorevich");
  addSpace(6);

  // Consent section
  addText("Soglasie na obrabotku personalnyh dannyh", { bold: true, size: 11 });
  addSpace(2);
  addText(
    "Nastojashim prinimayu reshenie o predostavlenii moih personalnyh dannyh i dayu Operatoru - ZAO AJUR inkam, v lice Direktora upravljajushej organizacii Kovrizhkina Alekseja Igorevicha, dejstvujushego na osnovanii Ustava, v sootvetstvii so statej 5 Zakona Respubliki Belarus ot 07.05.2021 N 99-Z O zashite personalnyh dannyh, soglasie na obrabotku personalnyh dannyh."
  );
  addSpace(4);
  addText(
    "Soglasie na obrabotku personalnyh dannyh javljaetsja konkretnym, predmetnym, informirovannym, soznatelnym i odnoznachnym."
  );
  addSpace(6);

  // Processing methods
  addText("Sposoby obrabotki personalnyh dannyh", { bold: true, size: 11 });
  addSpace(2);
  addText("Obrabotka personalnyh dannyh osushestvljaetsja sledujushimi sposobami:");
  const methods = [
    "Sbor", "Zapis", "Sistematizacija", "Nakoplenie", "Hranenie",
    "Utochnenie (obnovlenie, izmenenie)", "Izvlechenie", "Ispolzovanie",
    "Peredacha (rasprostranenie, predostavlenie, dostup)", "Obezlichivanie",
    "Blokirovanie", "Udalenie", "Unichtozhenie"
  ];
  methods.forEach((method) => {
    addText(`• ${method}`, { indent: 5 });
  });
  addSpace(4);
  addText(
    "Obrabotka osushestvljaetsja v informacionnyh sistemah personalnyh dannyh s ispolzovaniem sredstv avtomatizacii ili bez ispolzovanija takih sredstv."
  );
  addSpace(6);

  // Anonymous data collection
  addText("Sbor obezlichennyh dannyh", { bold: true, size: 11 });
  addSpace(2);
  addText(
    "Ja soglashajus s tem, chto na sajte proishodit sbor i obrabotka obezlichennyh dannyh o posetiteljah (v t.ch. fajlov cookies) s pomoshju servisov internet-statistiki (Jandeks Metrika i drugih)."
  );
  addSpace(6);

  // Consent procedure
  addText("Porjadok vyrazhenija soglasija", { bold: true, size: 11 });
  addSpace(2);
  addText(
    "Ja soglashajus s tem, chto schitajus davshim(-ej) soglasie na obrabotku svoih personalnyh dannyh, vnesennyh v polja formy, v moment prostavlenija simvola v chek-bokse v seti Internet po adresam:"
  );
  addText("• gorbova.by", { indent: 5 });
  addText("• gorbova.pro", { indent: 5 });
  addText("• gorbova.getcourse.ru", { indent: 5 });
  addText("vkljuchaja vse domeny, subdomeny i stranicy.", { indent: 5 });
  addSpace(6);

  // Validity
  addText("Srok dejstvija soglasija", { bold: true, size: 11 });
  addSpace(2);
  addText(
    "Nastojaschee soglasie dejstvuet so dnja ego podpisanija do dnja otzyva v pismennoj/elektronnoj forme."
  );
  addSpace(6);

  // Revocation
  addText("Porjadok otzyva soglasija", { bold: true, size: 11 });
  addSpace(2);
  addText(
    "Otzyv nastojaschego soglasija osushestvljaetsja v pismennoj ili elektronnoj forme putem napravlenija sootvetstvujushego zajavlenija na adres elektronnoj pochty Operatora: info@ajoure.by ili v pismennoj forme na pochtovyj adres: 220052, Respublika Belarus, g. Minsk, a/ja 63."
  );
  addSpace(4);
  addText(
    "Posle poluchenija otzyva soglasija Operator prekrashaet obrabotku personalnyh dannyh i unichtozhaet ih v srok, ne prevyshajushij 15 rabochih dnej s daty poluchenija otzyva.",
    { size: 9 }
  );
  addSpace(6);

  // Legal basis
  addText("Pravovoe osnovanie", { bold: true, size: 11 });
  addSpace(2);
  addText(
    "Obrabotka personalnyh dannyh osushestvljaetsja v sootvetstvii s Zakonom Respubliki Belarus ot 07.05.2021 N 99-Z O zashite personalnyh dannyh."
  );

  // Footer
  addSpace(10);
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  const date = new Date().toLocaleDateString("ru-RU");
  doc.text(`Dokument sgenerirovan: ${date}`, margin, yPosition);

  return doc;
}

export function downloadPolicyPdf() {
  const doc = generatePolicyPdf();
  doc.save("privacy-policy.pdf");
}
