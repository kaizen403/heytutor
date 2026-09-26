/**
 * Compound names to molecular graphs for the organic family.
 *
 * Two routes: a catalog of trivial and common names used in JEE Main
 * (acetone, isopropyl alcohol, picric acid, CH3MgBr) and a systematic
 * IUPAC reader for acyclic and monocyclic parents with substituent prefixes,
 * unsaturation, principal suffixes, esters, radicofunctional names, and the
 * benzene family templates (phenol, aniline, toluene, benzoic acid ...).
 * The reader returns null the moment a name has a piece it does not fully
 * understand: a partial parse would draw a different molecule than the one
 * the question names, which is worse than no figure.
 */
import { attachMolecule, parseSmiles, valenceOk, type BondOrder, type Molecule } from "./smiles";

interface CatalogEntry {
  readonly name: string;
  readonly smiles: string;
  readonly aliases?: readonly string[];
  /** Formula to display in place of the computed one (a salt shown as its cation). */
  readonly formula?: string;
}

/* ------------------------------------------------------------------------- */
/* Catalog                                                                   */
/* ------------------------------------------------------------------------- */

const CATALOG: readonly CatalogEntry[] = [
  // alkanes
  { name: "methane", smiles: "C", aliases: ["CH4"] },
  { name: "ethane", smiles: "CC", aliases: ["C2H6", "CH3CH3"] },
  { name: "propane", smiles: "CCC", aliases: ["C3H8"] },
  { name: "butane", smiles: "CCCC", aliases: ["n-butane"] },
  { name: "pentane", smiles: "CCCCC", aliases: ["n-pentane"] },
  { name: "hexane", smiles: "CCCCCC", aliases: ["n-hexane"] },
  { name: "heptane", smiles: "CCCCCCC", aliases: ["n-heptane"] },
  { name: "octane", smiles: "CCCCCCCC", aliases: ["n-octane"] },
  { name: "nonane", smiles: "CCCCCCCCC" },
  { name: "decane", smiles: "CCCCCCCCCC" },
  { name: "isobutane", smiles: "CC(C)C", aliases: ["2-methylpropane", "iso-butane"] },
  { name: "isopentane", smiles: "CC(C)CC", aliases: ["2-methylbutane", "iso-pentane"] },
  { name: "neopentane", smiles: "CC(C)(C)C", aliases: ["2,2-dimethylpropane", "neo-pentane"] },
  // alkenes and alkynes
  { name: "ethene", smiles: "C=C", aliases: ["ethylene", "C2H4", "CH2=CH2"] },
  { name: "propene", smiles: "C=CC", aliases: ["propylene", "C3H6", "CH3CH=CH2", "CH2=CHCH3"] },
  { name: "but-1-ene", smiles: "C=CCC", aliases: ["1-butene"] },
  { name: "but-2-ene", smiles: "CC=CC", aliases: ["2-butene"] },
  { name: "2-methylpropene", smiles: "C=C(C)C", aliases: ["isobutylene", "isobutene", "2-methylprop-1-ene", "2-methyl-1-propene"] },
  { name: "buta-1,3-diene", smiles: "C=CC=C", aliases: ["1,3-butadiene", "butadiene"] },
  { name: "isoprene", smiles: "C=C(C)C=C", aliases: ["2-methylbuta-1,3-diene", "2-methyl-1,3-butadiene"] },
  { name: "chloroprene", smiles: "C=C(Cl)C=C", aliases: ["2-chlorobuta-1,3-diene"] },
  { name: "allene", smiles: "C=C=C", aliases: ["propa-1,2-diene", "propadiene"] },
  { name: "ethyne", smiles: "C#C", aliases: ["acetylene", "C2H2"] },
  { name: "propyne", smiles: "CC#C", aliases: ["methylacetylene"] },
  { name: "but-1-yne", smiles: "C#CCC", aliases: ["1-butyne"] },
  { name: "but-2-yne", smiles: "CC#CC", aliases: ["2-butyne", "dimethylacetylene"] },
  { name: "vinylacetylene", smiles: "C=CC#C", aliases: ["but-1-en-3-yne"] },
  // aromatics
  { name: "benzene", smiles: "c1ccccc1", aliases: ["C6H6"] },
  { name: "toluene", smiles: "Cc1ccccc1", aliases: ["methylbenzene", "C6H5CH3"] },
  { name: "o-xylene", smiles: "Cc1ccccc1C", aliases: ["ortho-xylene", "1,2-dimethylbenzene"] },
  { name: "m-xylene", smiles: "Cc1cccc(C)c1", aliases: ["meta-xylene", "1,3-dimethylbenzene"] },
  { name: "p-xylene", smiles: "Cc1ccc(C)cc1", aliases: ["para-xylene", "1,4-dimethylbenzene"] },
  { name: "mesitylene", smiles: "Cc1cc(C)cc(C)c1", aliases: ["1,3,5-trimethylbenzene"] },
  { name: "ethylbenzene", smiles: "CCc1ccccc1" },
  { name: "cumene", smiles: "CC(C)c1ccccc1", aliases: ["isopropylbenzene"] },
  { name: "styrene", smiles: "C=Cc1ccccc1", aliases: ["vinylbenzene", "phenylethene"] },
  { name: "biphenyl", smiles: "c1ccc(cc1)-c1ccccc1", aliases: ["diphenyl"] },
  { name: "naphthalene", smiles: "c1ccc2ccccc2c1", aliases: ["C10H8"] },
  { name: "anthracene", smiles: "c1ccc2cc3ccccc3cc2c1" },
  { name: "phenanthrene", smiles: "c1ccc2c(c1)ccc1ccccc12" },
  { name: "phenol", smiles: "Oc1ccccc1", aliases: ["C6H5OH", "hydroxybenzene", "carbolic acid"] },
  { name: "aniline", smiles: "Nc1ccccc1", aliases: ["C6H5NH2", "aminobenzene", "benzenamine", "phenylamine"] },
  { name: "benzoic acid", smiles: "OC(=O)c1ccccc1", aliases: ["C6H5COOH", "benzenecarboxylic acid"] },
  { name: "benzaldehyde", smiles: "O=Cc1ccccc1", aliases: ["C6H5CHO", "benzenecarbaldehyde"] },
  { name: "acetophenone", smiles: "CC(=O)c1ccccc1", aliases: ["C6H5COCH3", "methyl phenyl ketone", "phenyl methyl ketone", "1-phenylethanone", "1-phenylethan-1-one"] },
  { name: "benzophenone", smiles: "O=C(c1ccccc1)c1ccccc1", aliases: ["diphenyl ketone", "diphenylmethanone"] },
  { name: "nitrobenzene", smiles: "[O-][N+](=O)c1ccccc1", aliases: ["C6H5NO2"] },
  { name: "chlorobenzene", smiles: "Clc1ccccc1", aliases: ["C6H5Cl"] },
  { name: "bromobenzene", smiles: "Brc1ccccc1", aliases: ["C6H5Br"] },
  { name: "iodobenzene", smiles: "Ic1ccccc1" },
  { name: "fluorobenzene", smiles: "Fc1ccccc1" },
  { name: "anisole", smiles: "COc1ccccc1", aliases: ["methoxybenzene", "methyl phenyl ether", "C6H5OCH3"] },
  { name: "phenetole", smiles: "CCOc1ccccc1", aliases: ["ethoxybenzene", "ethyl phenyl ether"] },
  { name: "benzyl alcohol", smiles: "OCc1ccccc1", aliases: ["phenylmethanol", "C6H5CH2OH"] },
  { name: "benzyl chloride", smiles: "ClCc1ccccc1", aliases: ["C6H5CH2Cl", "(chloromethyl)benzene"] },
  { name: "benzyl bromide", smiles: "BrCc1ccccc1", aliases: ["C6H5CH2Br"] },
  { name: "benzylamine", smiles: "NCc1ccccc1", aliases: ["phenylmethanamine", "C6H5CH2NH2"] },
  { name: "benzonitrile", smiles: "N#Cc1ccccc1", aliases: ["phenyl cyanide", "C6H5CN", "cyanobenzene"] },
  { name: "benzamide", smiles: "NC(=O)c1ccccc1", aliases: ["C6H5CONH2"] },
  { name: "benzoyl chloride", smiles: "ClC(=O)c1ccccc1", aliases: ["C6H5COCl"] },
  { name: "benzenesulphonic acid", smiles: "OS(=O)(=O)c1ccccc1", aliases: ["benzenesulfonic acid", "C6H5SO3H"] },
  { name: "benzenediazonium chloride", smiles: "[N+](#N)c1ccccc1", aliases: ["C6H5N2Cl", "C6H5N2+Cl-", "benzene diazonium chloride"], formula: "C_6H_5N_2Cl" },
  { name: "salicylic acid", smiles: "OC(=O)c1ccccc1O", aliases: ["2-hydroxybenzoic acid", "o-hydroxybenzoic acid"] },
  { name: "aspirin", smiles: "CC(=O)Oc1ccccc1C(=O)O", aliases: ["acetylsalicylic acid", "2-acetoxybenzoic acid"] },
  { name: "salicylaldehyde", smiles: "O=Cc1ccccc1O", aliases: ["2-hydroxybenzaldehyde", "o-hydroxybenzaldehyde"] },
  { name: "phthalic acid", smiles: "OC(=O)c1ccccc1C(=O)O", aliases: ["benzene-1,2-dicarboxylic acid"] },
  { name: "terephthalic acid", smiles: "OC(=O)c1ccc(cc1)C(=O)O", aliases: ["benzene-1,4-dicarboxylic acid"] },
  { name: "picric acid", smiles: "Oc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]", aliases: ["2,4,6-trinitrophenol"] },
  { name: "TNT", smiles: "Cc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]", aliases: ["2,4,6-trinitrotoluene", "trinitrotoluene"] },
  { name: "o-cresol", smiles: "Cc1ccccc1O", aliases: ["2-methylphenol", "ortho-cresol"] },
  { name: "m-cresol", smiles: "Cc1cccc(O)c1", aliases: ["3-methylphenol", "meta-cresol"] },
  { name: "p-cresol", smiles: "Cc1ccc(O)cc1", aliases: ["4-methylphenol", "para-cresol"] },
  { name: "catechol", smiles: "Oc1ccccc1O", aliases: ["benzene-1,2-diol", "1,2-dihydroxybenzene"] },
  { name: "resorcinol", smiles: "Oc1cccc(O)c1", aliases: ["benzene-1,3-diol", "1,3-dihydroxybenzene"] },
  { name: "hydroquinone", smiles: "Oc1ccc(O)cc1", aliases: ["benzene-1,4-diol", "quinol", "1,4-dihydroxybenzene"] },
  { name: "p-benzoquinone", smiles: "O=C1C=CC(=O)C=C1", aliases: ["benzoquinone", "1,4-benzoquinone", "cyclohexa-2,5-diene-1,4-dione"] },
  { name: "o-toluidine", smiles: "Cc1ccccc1N", aliases: ["2-methylaniline", "ortho-toluidine"] },
  { name: "m-toluidine", smiles: "Cc1cccc(N)c1", aliases: ["3-methylaniline", "meta-toluidine"] },
  { name: "p-toluidine", smiles: "Cc1ccc(N)cc1", aliases: ["4-methylaniline", "para-toluidine"] },
  { name: "N-methylaniline", smiles: "CNc1ccccc1" },
  { name: "N,N-dimethylaniline", smiles: "CN(C)c1ccccc1" },
  { name: "diphenylamine", smiles: "c1ccc(Nc2ccccc2)cc1" },
  { name: "acetanilide", smiles: "CC(=O)Nc1ccccc1", aliases: ["N-phenylacetamide", "N-phenylethanamide"] },
  { name: "paracetamol", smiles: "CC(=O)Nc1ccc(O)cc1", aliases: ["acetaminophen", "N-(4-hydroxyphenyl)acetamide"] },
  { name: "phenylhydrazine", smiles: "NNc1ccccc1" },
  { name: "1-naphthol", smiles: "Oc1cccc2ccccc12", aliases: ["alpha-naphthol", "naphthalen-1-ol"] },
  { name: "2-naphthol", smiles: "Oc1ccc2ccccc2c1", aliases: ["beta-naphthol", "naphthalen-2-ol"] },
  { name: "methyl benzoate", smiles: "COC(=O)c1ccccc1", aliases: ["C6H5COOCH3"] },
  { name: "ethyl benzoate", smiles: "CCOC(=O)c1ccccc1", aliases: ["C6H5COOC2H5"] },
  { name: "phenyl acetate", smiles: "CC(=O)Oc1ccccc1", aliases: ["phenyl ethanoate"] },
  { name: "cinnamaldehyde", smiles: "O=C/C=C/c1ccccc1", aliases: ["3-phenylprop-2-enal"] },
  { name: "cinnamic acid", smiles: "OC(=O)/C=C/c1ccccc1", aliases: ["3-phenylprop-2-enoic acid"] },
  { name: "benzyl cyanide", smiles: "N#CCc1ccccc1", aliases: ["phenylacetonitrile", "C6H5CH2CN"] },
  { name: "phenylacetic acid", smiles: "OC(=O)Cc1ccccc1", aliases: ["2-phenylethanoic acid"] },
  { name: "BHC", smiles: "ClC1C(Cl)C(Cl)C(Cl)C(Cl)C1Cl", aliases: ["benzene hexachloride", "gammaxene", "lindane", "1,2,3,4,5,6-hexachlorocyclohexane"] },
  { name: "pyridine", smiles: "c1ccncc1", aliases: ["C5H5N"] },
  { name: "pyrrole", smiles: "c1cc[nH]c1" },
  { name: "furan", smiles: "c1ccoc1" },
  { name: "thiophene", smiles: "c1ccsc1" },
  { name: "piperidine", smiles: "C1CCNCC1" },
  { name: "pyrrolidine", smiles: "C1CCNC1" },
  { name: "tetrahydrofuran", smiles: "C1CCOC1", aliases: ["THF", "oxolane"] },
  { name: "1,4-dioxane", smiles: "C1COCCO1", aliases: ["dioxane"] },
  { name: "ethylene oxide", smiles: "C1CO1", aliases: ["oxirane", "epoxyethane"] },
  { name: "propylene oxide", smiles: "CC1CO1", aliases: ["methyloxirane", "1,2-epoxypropane"] },
  // cycloalkanes
  { name: "cyclopropane", smiles: "C1CC1" },
  { name: "cyclobutane", smiles: "C1CCC1" },
  { name: "cyclopentane", smiles: "C1CCCC1" },
  { name: "cyclohexane", smiles: "C1CCCCC1", aliases: ["C6H12"] },
  { name: "cycloheptane", smiles: "C1CCCCCC1" },
  { name: "cyclopentene", smiles: "C1CCC=C1" },
  { name: "cyclohexene", smiles: "C1CCC=CC1" },
  { name: "cyclohexanol", smiles: "OC1CCCCC1" },
  { name: "cyclohexanone", smiles: "O=C1CCCCC1" },
  { name: "cyclopentanone", smiles: "O=C1CCCC1" },
  { name: "cyclohexylamine", smiles: "NC1CCCCC1", aliases: ["cyclohexanamine"] },
  { name: "methylcyclohexane", smiles: "CC1CCCCC1" },
  { name: "cyclopentadiene", smiles: "C1C=CC=C1", aliases: ["cyclopenta-1,3-diene", "1,3-cyclopentadiene"] },
  // alcohols, ethers
  { name: "methanol", smiles: "CO", aliases: ["methyl alcohol", "CH3OH", "wood spirit"] },
  { name: "ethanol", smiles: "CCO", aliases: ["ethyl alcohol", "C2H5OH", "CH3CH2OH"] },
  { name: "propan-1-ol", smiles: "CCCO", aliases: ["1-propanol", "n-propyl alcohol", "propyl alcohol", "n-propanol", "CH3CH2CH2OH"] },
  { name: "propan-2-ol", smiles: "CC(C)O", aliases: ["2-propanol", "isopropyl alcohol", "isopropanol", "iso-propyl alcohol", "(CH3)2CHOH"] },
  { name: "butan-1-ol", smiles: "CCCCO", aliases: ["1-butanol", "n-butyl alcohol", "butyl alcohol", "n-butanol"] },
  { name: "butan-2-ol", smiles: "CCC(C)O", aliases: ["2-butanol", "sec-butyl alcohol", "sec-butanol"] },
  { name: "2-methylpropan-1-ol", smiles: "CC(C)CO", aliases: ["isobutyl alcohol", "isobutanol", "2-methyl-1-propanol"] },
  { name: "2-methylpropan-2-ol", smiles: "CC(C)(C)O", aliases: ["tert-butyl alcohol", "tert-butanol", "t-butyl alcohol", "t-butanol", "2-methyl-2-propanol", "(CH3)3COH"] },
  { name: "allyl alcohol", smiles: "C=CCO", aliases: ["prop-2-en-1-ol", "2-propen-1-ol"] },
  { name: "ethylene glycol", smiles: "OCCO", aliases: ["ethane-1,2-diol", "1,2-ethanediol", "glycol"] },
  { name: "glycerol", smiles: "OCC(O)CO", aliases: ["glycerine", "propane-1,2,3-triol", "1,2,3-propanetriol"] },
  { name: "dimethyl ether", smiles: "COC", aliases: ["methoxymethane", "CH3OCH3"] },
  { name: "diethyl ether", smiles: "CCOCC", aliases: ["ethoxyethane", "diethylether", "C2H5OC2H5"] },
  { name: "ethyl methyl ether", smiles: "CCOC", aliases: ["methoxyethane", "methyl ethyl ether"] },
  // carbonyls
  { name: "formaldehyde", smiles: "C=O", aliases: ["methanal", "HCHO"] },
  { name: "acetaldehyde", smiles: "CC=O", aliases: ["ethanal", "CH3CHO"] },
  { name: "propanal", smiles: "CCC=O", aliases: ["propionaldehyde", "CH3CH2CHO"] },
  { name: "butanal", smiles: "CCCC=O", aliases: ["butyraldehyde", "n-butyraldehyde"] },
  { name: "acrolein", smiles: "C=CC=O", aliases: ["propenal", "prop-2-enal", "acrylaldehyde"] },
  { name: "crotonaldehyde", smiles: "C/C=C/C=O", aliases: ["but-2-enal", "2-butenal"] },
  { name: "glyoxal", smiles: "O=CC=O", aliases: ["ethanedial", "oxaldehyde"] },
  { name: "chloral", smiles: "ClC(Cl)(Cl)C=O", aliases: ["trichloroacetaldehyde", "2,2,2-trichloroethanal", "trichloroethanal"] },
  { name: "acetone", smiles: "CC(C)=O", aliases: ["propanone", "propan-2-one", "2-propanone", "dimethyl ketone", "CH3COCH3"] },
  { name: "butanone", smiles: "CCC(C)=O", aliases: ["butan-2-one", "2-butanone", "methyl ethyl ketone", "ethyl methyl ketone", "MEK", "CH3COC2H5", "CH3COCH2CH3"] },
  { name: "pentan-3-one", smiles: "CCC(=O)CC", aliases: ["3-pentanone", "diethyl ketone"] },
  { name: "pentan-2-one", smiles: "CCCC(C)=O", aliases: ["2-pentanone", "methyl propyl ketone"] },
  { name: "acetylacetone", smiles: "CC(=O)CC(C)=O", aliases: ["pentane-2,4-dione", "2,4-pentanedione"] },
  { name: "diacetyl", smiles: "CC(=O)C(C)=O", aliases: ["butane-2,3-dione", "2,3-butanedione"] },
  { name: "mesityl oxide", smiles: "CC(C)=CC(C)=O", aliases: ["4-methylpent-3-en-2-one"] },
  { name: "methyl vinyl ketone", smiles: "C=CC(C)=O", aliases: ["but-3-en-2-one", "3-buten-2-one"] },
  { name: "acetoin", smiles: "CC(O)C(C)=O", aliases: ["3-hydroxybutan-2-one"] },
  { name: "phosgene", smiles: "ClC(Cl)=O", aliases: ["carbonyl chloride", "COCl2"] },
  // acids and derivatives
  { name: "formic acid", smiles: "OC=O", aliases: ["methanoic acid", "HCOOH"] },
  { name: "acetic acid", smiles: "CC(O)=O", aliases: ["ethanoic acid", "CH3COOH"] },
  { name: "propanoic acid", smiles: "CCC(O)=O", aliases: ["propionic acid", "CH3CH2COOH", "C2H5COOH"] },
  { name: "butanoic acid", smiles: "CCCC(O)=O", aliases: ["butyric acid", "n-butyric acid"] },
  { name: "isobutyric acid", smiles: "CC(C)C(O)=O", aliases: ["2-methylpropanoic acid"] },
  { name: "oxalic acid", smiles: "OC(=O)C(O)=O", aliases: ["ethanedioic acid", "(COOH)2"] },
  { name: "malonic acid", smiles: "OC(=O)CC(O)=O", aliases: ["propanedioic acid"] },
  { name: "succinic acid", smiles: "OC(=O)CCC(O)=O", aliases: ["butanedioic acid"] },
  { name: "glutaric acid", smiles: "OC(=O)CCCC(O)=O", aliases: ["pentanedioic acid"] },
  { name: "adipic acid", smiles: "OC(=O)CCCCC(O)=O", aliases: ["hexanedioic acid"] },
  { name: "lactic acid", smiles: "CC(O)C(O)=O", aliases: ["2-hydroxypropanoic acid", "2-hydroxypropionic acid"] },
  { name: "pyruvic acid", smiles: "CC(=O)C(O)=O", aliases: ["2-oxopropanoic acid"] },
  { name: "acrylic acid", smiles: "C=CC(O)=O", aliases: ["propenoic acid", "prop-2-enoic acid"] },
  { name: "crotonic acid", smiles: "C/C=C/C(O)=O", aliases: ["but-2-enoic acid", "trans-but-2-enoic acid"] },
  { name: "maleic acid", smiles: "OC(=O)/C=C\\C(O)=O", aliases: ["cis-butenedioic acid", "(z)-butenedioic acid", "cis-but-2-enedioic acid"] },
  { name: "fumaric acid", smiles: "OC(=O)/C=C/C(O)=O", aliases: ["trans-butenedioic acid", "(e)-butenedioic acid", "trans-but-2-enedioic acid"] },
  { name: "tartaric acid", smiles: "OC(C(O)C(O)=O)C(O)=O", aliases: ["2,3-dihydroxybutanedioic acid"] },
  { name: "citric acid", smiles: "OC(=O)CC(O)(CC(O)=O)C(O)=O" },
  { name: "chloroacetic acid", smiles: "ClCC(O)=O", aliases: ["chloroethanoic acid", "2-chloroethanoic acid", "monochloroacetic acid"] },
  { name: "dichloroacetic acid", smiles: "ClC(Cl)C(O)=O", aliases: ["2,2-dichloroethanoic acid"] },
  { name: "trichloroacetic acid", smiles: "ClC(Cl)(Cl)C(O)=O", aliases: ["2,2,2-trichloroethanoic acid", "trichloroethanoic acid"] },
  { name: "trifluoroacetic acid", smiles: "FC(F)(F)C(O)=O", aliases: ["2,2,2-trifluoroethanoic acid"] },
  { name: "acetic anhydride", smiles: "CC(=O)OC(C)=O", aliases: ["ethanoic anhydride", "(CH3CO)2O"] },
  { name: "acetyl chloride", smiles: "CC(=O)Cl", aliases: ["ethanoyl chloride", "CH3COCl"] },
  { name: "ethyl acetate", smiles: "CCOC(C)=O", aliases: ["ethyl ethanoate", "CH3COOC2H5"] },
  { name: "methyl acetate", smiles: "COC(C)=O", aliases: ["methyl ethanoate", "CH3COOCH3"] },
  { name: "ethyl formate", smiles: "CCOC=O", aliases: ["ethyl methanoate", "HCOOC2H5"] },
  { name: "methyl formate", smiles: "COC=O", aliases: ["methyl methanoate", "HCOOCH3"] },
  { name: "acetamide", smiles: "CC(N)=O", aliases: ["ethanamide", "CH3CONH2"] },
  { name: "formamide", smiles: "NC=O", aliases: ["methanamide", "HCONH2"] },
  { name: "N,N-dimethylformamide", smiles: "CN(C)C=O", aliases: ["DMF", "dimethylformamide"] },
  { name: "urea", smiles: "NC(N)=O", aliases: ["carbamide", "NH2CONH2"] },
  { name: "acetonitrile", smiles: "CC#N", aliases: ["methyl cyanide", "ethanenitrile", "CH3CN"] },
  { name: "methyl isocyanide", smiles: "C[N+]#[C-]", aliases: ["methyl carbylamine", "CH3NC", "isocyanomethane"] },
  { name: "acrylonitrile", smiles: "C=CC#N", aliases: ["propenenitrile", "prop-2-enenitrile", "vinyl cyanide"] },
  // amines and nitro compounds
  { name: "methylamine", smiles: "CN", aliases: ["methanamine", "CH3NH2"] },
  { name: "dimethylamine", smiles: "CNC", aliases: ["N-methylmethanamine", "(CH3)2NH"] },
  { name: "trimethylamine", smiles: "CN(C)C", aliases: ["N,N-dimethylmethanamine", "(CH3)3N"] },
  { name: "ethylamine", smiles: "CCN", aliases: ["ethanamine", "C2H5NH2", "CH3CH2NH2"] },
  { name: "diethylamine", smiles: "CCNCC", aliases: ["N-ethylethanamine", "(C2H5)2NH"] },
  { name: "triethylamine", smiles: "CCN(CC)CC", aliases: ["N,N-diethylethanamine", "(C2H5)3N"] },
  { name: "propylamine", smiles: "CCCN", aliases: ["propan-1-amine", "1-propanamine", "n-propylamine"] },
  { name: "isopropylamine", smiles: "CC(C)N", aliases: ["propan-2-amine", "2-propanamine"] },
  { name: "butylamine", smiles: "CCCCN", aliases: ["butan-1-amine", "n-butylamine"] },
  { name: "tert-butylamine", smiles: "CC(C)(C)N", aliases: ["2-methylpropan-2-amine", "t-butylamine"] },
  { name: "ethylenediamine", smiles: "NCCN", aliases: ["ethane-1,2-diamine", "1,2-diaminoethane"] },
  { name: "nitromethane", smiles: "C[N+](=O)[O-]", aliases: ["CH3NO2"] },
  { name: "nitroethane", smiles: "CC[N+](=O)[O-]", aliases: ["C2H5NO2"] },
  // halides
  { name: "chloromethane", smiles: "CCl", aliases: ["methyl chloride", "CH3Cl"] },
  { name: "dichloromethane", smiles: "ClCCl", aliases: ["methylene chloride", "methylene dichloride", "CH2Cl2"] },
  { name: "chloroform", smiles: "ClC(Cl)Cl", aliases: ["trichloromethane", "CHCl3"] },
  { name: "carbon tetrachloride", smiles: "ClC(Cl)(Cl)Cl", aliases: ["tetrachloromethane", "CCl4"] },
  { name: "bromomethane", smiles: "CBr", aliases: ["methyl bromide", "CH3Br"] },
  { name: "iodomethane", smiles: "CI", aliases: ["methyl iodide", "CH3I"] },
  { name: "triiodomethane", smiles: "IC(I)I", aliases: ["CHI3"] },
  { name: "bromoform", smiles: "BrC(Br)Br", aliases: ["tribromomethane", "CHBr3"] },
  { name: "chloroethane", smiles: "CCCl", aliases: ["ethyl chloride", "C2H5Cl", "CH3CH2Cl"] },
  { name: "bromoethane", smiles: "CCBr", aliases: ["ethyl bromide", "C2H5Br", "CH3CH2Br"] },
  { name: "iodoethane", smiles: "CCI", aliases: ["ethyl iodide", "C2H5I"] },
  { name: "1-chloropropane", smiles: "CCCCl", aliases: ["n-propyl chloride", "propyl chloride"] },
  { name: "2-chloropropane", smiles: "CC(C)Cl", aliases: ["isopropyl chloride", "iso-propyl chloride"] },
  { name: "1-bromopropane", smiles: "CCCBr", aliases: ["n-propyl bromide", "propyl bromide"] },
  { name: "2-bromopropane", smiles: "CC(C)Br", aliases: ["isopropyl bromide", "iso-propyl bromide"] },
  { name: "1-chlorobutane", smiles: "CCCCCl", aliases: ["n-butyl chloride", "butyl chloride"] },
  { name: "2-chlorobutane", smiles: "CCC(C)Cl", aliases: ["sec-butyl chloride"] },
  { name: "1-bromobutane", smiles: "CCCCBr", aliases: ["n-butyl bromide", "butyl bromide"] },
  { name: "2-bromobutane", smiles: "CCC(C)Br", aliases: ["sec-butyl bromide"] },
  { name: "2-chloro-2-methylpropane", smiles: "CC(C)(C)Cl", aliases: ["tert-butyl chloride", "t-butyl chloride", "(CH3)3CCl"] },
  { name: "2-bromo-2-methylpropane", smiles: "CC(C)(C)Br", aliases: ["tert-butyl bromide", "t-butyl bromide", "(CH3)3CBr"] },
  { name: "1-chloro-2-methylpropane", smiles: "CC(C)CCl", aliases: ["isobutyl chloride"] },
  { name: "1-bromo-2-methylpropane", smiles: "CC(C)CBr", aliases: ["isobutyl bromide"] },
  { name: "vinyl chloride", smiles: "C=CCl", aliases: ["chloroethene", "chloroethylene"] },
  { name: "vinyl bromide", smiles: "C=CBr", aliases: ["bromoethene"] },
  { name: "allyl chloride", smiles: "C=CCCl", aliases: ["3-chloropropene", "3-chloroprop-1-ene", "3-chloro-1-propene"] },
  { name: "allyl bromide", smiles: "C=CCBr", aliases: ["3-bromopropene", "3-bromoprop-1-ene", "3-bromo-1-propene"] },
  { name: "1,2-dichloroethane", smiles: "ClCCCl", aliases: ["ethylene dichloride", "ethylene chloride"] },
  { name: "1,1-dichloroethane", smiles: "CC(Cl)Cl", aliases: ["ethylidene chloride", "ethylidene dichloride"] },
  { name: "1,2-dibromoethane", smiles: "BrCCBr", aliases: ["ethylene dibromide", "ethylene bromide"] },
  { name: "dichlorodifluoromethane", smiles: "ClC(Cl)(F)F", aliases: ["freon-12", "CCl2F2"] },
  // organometallics
  { name: "methylmagnesium bromide", smiles: "C[Mg]Br", aliases: ["CH3MgBr", "methyl magnesium bromide"], formula: "CH_3MgBr" },
  { name: "ethylmagnesium bromide", smiles: "CC[Mg]Br", aliases: ["C2H5MgBr", "ethyl magnesium bromide", "CH3CH2MgBr"], formula: "C_2H_5MgBr" },
  { name: "phenylmagnesium bromide", smiles: "Br[Mg]c1ccccc1", aliases: ["C6H5MgBr", "phenyl magnesium bromide", "PhMgBr"], formula: "C_6H_5MgBr" },
  { name: "methyllithium", smiles: "C[Li]", aliases: ["CH3Li"] },
  // biomolecules and small polyfunctional compounds
  { name: "glucose", smiles: "OCC(O)C(O)C(O)C(O)C=O", aliases: ["d-glucose", "dextrose", "C6H12O6"] },
  { name: "fructose", smiles: "OCC(O)C(O)C(O)C(=O)CO", aliases: ["d-fructose"] },
  { name: "glycine", smiles: "NCC(O)=O", aliases: ["aminoacetic acid", "2-aminoethanoic acid", "aminoethanoic acid"] },
  { name: "alanine", smiles: "CC(N)C(O)=O", aliases: ["2-aminopropanoic acid"] },
  { name: "ethanolamine", smiles: "NCCO", aliases: ["2-aminoethanol", "2-aminoethan-1-ol"] },
  { name: "chloral hydrate", smiles: "ClC(Cl)(Cl)C(O)O", aliases: ["2,2,2-trichloroethane-1,1-diol"] },
];

function catalogKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+]/g, "");
}

const CATALOG_BY_KEY = new Map<string, CatalogEntry>();
for (const entry of CATALOG) {
  for (const alias of [entry.name, ...(entry.aliases ?? [])]) {
    const key = catalogKey(alias);
    if (!CATALOG_BY_KEY.has(key)) CATALOG_BY_KEY.set(key, entry);
  }
}

function catalogLookup(text: string): Molecule | null {
  const entry = CATALOG_BY_KEY.get(catalogKey(text));
  if (!entry) return null;
  const molecule = parseSmiles(entry.smiles);
  if (!molecule) return null;
  molecule.name = entry.name;
  if (entry.formula) molecule.formulaOverride = entry.formula;
  return molecule;
}

/* ------------------------------------------------------------------------- */
/* Systematic names                                                          */
/* ------------------------------------------------------------------------- */

const STEMS: Record<string, number> = {
  meth: 1, eth: 2, prop: 3, but: 4, pent: 5, hex: 6, hept: 7, oct: 8, non: 9, dec: 10, undec: 11, dodec: 12,
};
const STEM_PATTERN = "meth|eth|prop|but|pent|hex|hept|oct|non|dec|undec|dodec";
const MULTIPLIERS: Record<string, number> = { di: 2, tri: 3, tetra: 4, penta: 5, hexa: 6, bis: 2, tris: 3 };

interface SubstituentSpec {
  /** Fragment as SMILES; its first atom bonds to the parent. */
  readonly smiles?: string;
  /** Fragment as a built graph (a complex substituent), joined at `attach`. */
  readonly fragment?: Molecule;
  readonly attach?: number;
  /** Bond order from the parent atom to the fragment. */
  readonly order?: BondOrder;
}

/** Substituent prefix names: the fragment's first atom bonds to the parent. */
const SUBSTITUENTS: Record<string, SubstituentSpec> = {
  methyl: { smiles: "C" }, ethyl: { smiles: "CC" }, propyl: { smiles: "CCC" }, isopropyl: { smiles: "C(C)C" },
  butyl: { smiles: "CCCC" }, isobutyl: { smiles: "CC(C)C" }, secbutyl: { smiles: "C(C)CC" }, tertbutyl: { smiles: "C(C)(C)C" },
  pentyl: { smiles: "CCCCC" }, isopentyl: { smiles: "CCC(C)C" }, neopentyl: { smiles: "CC(C)(C)C" }, hexyl: { smiles: "CCCCCC" },
  heptyl: { smiles: "CCCCCCC" }, octyl: { smiles: "CCCCCCCC" },
  vinyl: { smiles: "C=C" }, ethenyl: { smiles: "C=C" }, allyl: { smiles: "CC=C" }, propenyl: { smiles: "C=CC" },
  ethynyl: { smiles: "C#C" }, propargyl: { smiles: "CC#C" },
  phenyl: { smiles: "c1ccccc1" }, benzyl: { smiles: "Cc1ccccc1" },
  cyclopropyl: { smiles: "C1CC1" }, cyclobutyl: { smiles: "C1CCC1" }, cyclopentyl: { smiles: "C1CCCC1" }, cyclohexyl: { smiles: "C1CCCCC1" },
  fluoro: { smiles: "F" }, chloro: { smiles: "Cl" }, bromo: { smiles: "Br" }, iodo: { smiles: "I" },
  hydroxy: { smiles: "O" }, oxo: { smiles: "O", order: 2 }, amino: { smiles: "N" }, nitro: { smiles: "[N+](=O)[O-]" },
  cyano: { smiles: "C#N" }, isocyano: { smiles: "[N+]#[C-]" }, nitroso: { smiles: "N=O" },
  methoxy: { smiles: "OC" }, ethoxy: { smiles: "OCC" }, propoxy: { smiles: "OCCC" }, isopropoxy: { smiles: "OC(C)C" },
  tertbutoxy: { smiles: "OC(C)(C)C" }, phenoxy: { smiles: "Oc1ccccc1" }, benzyloxy: { smiles: "OCc1ccccc1" }, acetoxy: { smiles: "OC(C)=O" },
  formyl: { smiles: "C=O" }, carboxy: { smiles: "C(=O)O" }, acetyl: { smiles: "C(C)=O" }, benzoyl: { smiles: "C(=O)c1ccccc1" },
  methoxycarbonyl: { smiles: "C(=O)OC" }, ethoxycarbonyl: { smiles: "C(=O)OCC" }, carbamoyl: { smiles: "C(N)=O" },
  methylamino: { smiles: "NC" }, dimethylamino: { smiles: "N(C)C" }, ethylamino: { smiles: "NCC" }, diethylamino: { smiles: "N(CC)CC" },
  acetylamino: { smiles: "NC(C)=O" }, acetamido: { smiles: "NC(C)=O" },
  mercapto: { smiles: "S" }, sulfanyl: { smiles: "S" }, methylthio: { smiles: "SC" }, sulpho: { smiles: "S(=O)(=O)O" }, sulfo: { smiles: "S(=O)(=O)O" },
  chloromethyl: { smiles: "CCl" }, bromomethyl: { smiles: "CBr" }, hydroxymethyl: { smiles: "CO" }, aminomethyl: { smiles: "CN" },
  dichloromethyl: { smiles: "C(Cl)Cl" }, trichloromethyl: { smiles: "C(Cl)(Cl)Cl" }, trifluoromethyl: { smiles: "C(F)(F)F" },
  methylene: { smiles: "C", order: 2 }, ethylidene: { smiles: "CC", order: 2 },
};
const SUBSTITUENT_NAMES = Object.keys(SUBSTITUENTS).sort((a, b) => b.length - a.length);

/** Alkyl group names for radicofunctional names and ester alkyl parts. */
const ALKYL_GROUPS: Record<string, string> = {
  methyl: "C", ethyl: "CC", propyl: "CCC", isopropyl: "C(C)C", butyl: "CCCC", isobutyl: "CC(C)C", secbutyl: "C(C)CC",
  tertbutyl: "C(C)(C)C", pentyl: "CCCCC", isopentyl: "CCC(C)C", neopentyl: "CC(C)(C)C", hexyl: "CCCCCC", vinyl: "C=C",
  allyl: "CC=C", phenyl: "c1ccccc1", benzyl: "Cc1ccccc1", cyclohexyl: "C1CCCCC1", cyclopentyl: "C1CCCC1", cyclopropyl: "C1CC1",
};

const ACYL_GROUPS: Record<string, string> = {
  formyl: "C=O", acetyl: "C(C)=O", propionyl: "C(CC)=O", propanoyl: "C(CC)=O", butyryl: "C(CCC)=O", butanoyl: "C(CCC)=O",
  benzoyl: "C(=O)c1ccccc1", ethanoyl: "C(C)=O", methanoyl: "C=O",
};

interface RingTemplate {
  readonly smiles: string;
  /** Molecule atom index for each ring locant 1..n (index 0 holds locant 1). */
  readonly ring: readonly number[];
  /** Locants already used by the parent's own group. */
  readonly fixed: readonly number[];
  /** Atom index that N-locants attach to. */
  readonly nitrogen?: number;
}

const RING_TEMPLATES: Record<string, RingTemplate> = {
  benzene: { smiles: "c1ccccc1", ring: [0, 1, 2, 3, 4, 5], fixed: [] },
  toluene: { smiles: "Cc1ccccc1", ring: [1, 2, 3, 4, 5, 6], fixed: [1] },
  phenol: { smiles: "Oc1ccccc1", ring: [1, 2, 3, 4, 5, 6], fixed: [1] },
  aniline: { smiles: "Nc1ccccc1", ring: [1, 2, 3, 4, 5, 6], fixed: [1], nitrogen: 0 },
  benzenamine: { smiles: "Nc1ccccc1", ring: [1, 2, 3, 4, 5, 6], fixed: [1], nitrogen: 0 },
  "benzoic acid": { smiles: "OC(=O)c1ccccc1", ring: [3, 4, 5, 6, 7, 8], fixed: [1] },
  benzaldehyde: { smiles: "O=Cc1ccccc1", ring: [2, 3, 4, 5, 6, 7], fixed: [1] },
  acetophenone: { smiles: "CC(=O)c1ccccc1", ring: [3, 4, 5, 6, 7, 8], fixed: [1] },
  anisole: { smiles: "COc1ccccc1", ring: [2, 3, 4, 5, 6, 7], fixed: [1] },
  styrene: { smiles: "C=Cc1ccccc1", ring: [2, 3, 4, 5, 6, 7], fixed: [1] },
  benzonitrile: { smiles: "N#Cc1ccccc1", ring: [2, 3, 4, 5, 6, 7], fixed: [1] },
  benzamide: { smiles: "NC(=O)c1ccccc1", ring: [3, 4, 5, 6, 7, 8], fixed: [1], nitrogen: 0 },
  "benzoyl chloride": { smiles: "ClC(=O)c1ccccc1", ring: [3, 4, 5, 6, 7, 8], fixed: [1] },
  "benzenesulphonic acid": { smiles: "OS(=O)(=O)c1ccccc1", ring: [4, 5, 6, 7, 8, 9], fixed: [1] },
  "benzenesulfonic acid": { smiles: "OS(=O)(=O)c1ccccc1", ring: [4, 5, 6, 7, 8, 9], fixed: [1] },
  "benzyl alcohol": { smiles: "OCc1ccccc1", ring: [2, 3, 4, 5, 6, 7], fixed: [1] },
  "benzyl chloride": { smiles: "ClCc1ccccc1", ring: [2, 3, 4, 5, 6, 7], fixed: [1] },
  benzylamine: { smiles: "NCc1ccccc1", ring: [2, 3, 4, 5, 6, 7], fixed: [1], nitrogen: 0 },
  "phenylacetic acid": { smiles: "OC(=O)Cc1ccccc1", ring: [3, 4, 5, 6, 7, 8], fixed: [1] },
  naphthalene: { smiles: "c1cccc2ccccc12", ring: [0, 1, 2, 3, -1, 5, 6, 7, 8], fixed: [] },
  pyridine: { smiles: "n1ccccc1", ring: [0, 1, 2, 3, 4, 5], fixed: [1] },
  pyrrole: { smiles: "[nH]1cccc1", ring: [0, 1, 2, 3, 4], fixed: [1], nitrogen: 0 },
  furan: { smiles: "o1cccc1", ring: [0, 1, 2, 3, 4], fixed: [1] },
  thiophene: { smiles: "s1cccc1", ring: [0, 1, 2, 3, 4], fixed: [1] },
};
/** Parents whose o/m/p or numeric locant places one extra group relative to position 1. */
const DERIVED_RING_PARENTS: Record<string, { template: string; group: string }> = {
  cresol: { template: "phenol", group: "methyl" },
  xylene: { template: "toluene", group: "methyl" },
  toluidine: { template: "aniline", group: "methyl" },
  phenylenediamine: { template: "aniline", group: "amino" },
};
const RING_PARENT_PATTERN = [...Object.keys(RING_TEMPLATES), ...Object.keys(DERIVED_RING_PARENTS)]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/ /g, " "))
  .join("|");

interface PrefixItem {
  locants: string[];
  count: number;
  spec: SubstituentSpec;
  text: string;
}

/**
 * Normalise a name the way a student types it: lower case, ASCII hyphens,
 * no spaces around hyphens or locant commas, alkyl prefixes joined
 * ("tert-butyl" -> "tertbutyl"), and a leading n- dropped.
 */
export function normalizeName(raw: string): string {
  let text = raw.toLowerCase()
    .replace(/[–—−‐‑]/g, "-")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*-\s*/g, "-")
    .replace(/(\d)\s*,\s*(?=\d)/g, "$1,")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\)(?=[a-z])/g, ")");
  text = text
    .replace(/\b(tert|t)-(butyl|butoxy|butanol|butylamine)/g, "tert$2")
    .replace(/\bsec-(butyl)/g, "sec$1")
    .replace(/\b(iso|neo)-(propyl|butyl|pentyl|propanol|butane|pentane|butylene|propoxy)/g, "$1$2")
    .replace(/\bn-(?=(?:but|pent|hex|hept|oct|prop|dec)[a-z])/g, "")
    .replace(/\bortho-/g, "o-").replace(/\bmeta-/g, "m-").replace(/\bpara-/g, "p-")
    .replace(/\bacid\b\.?$/, "acid");
  return text;
}

function parseLocantList(text: string): string[] {
  return text.split(",").map((part) => part.trim()).filter(Boolean);
}

function omp(locant: string): number | null {
  return locant === "o" ? 2 : locant === "m" ? 3 : locant === "p" ? 4 : null;
}

/**
 * Read the substituent prefix string ("2-chloro-2-methyl", "n,n-dimethyl",
 * "2,4,6-trinitro", "3-(1-methylethyl)"). Must consume all of it.
 */
function parsePrefixes(prefix: string): PrefixItem[] | null {
  const items: PrefixItem[] = [];
  let rest = prefix;
  let guard = 0;
  while (rest.length > 0) {
    guard += 1;
    if (guard > 30) return null;
    rest = rest.replace(/^-+/, "");
    if (!rest) break;
    let locants: string[] = [];
    const locantMatch = /^(\d+(?:,\d+)*|[omp]|n(?:,n)*)-/.exec(rest);
    if (locantMatch) {
      locants = parseLocantList(locantMatch[1]!);
      rest = rest.slice(locantMatch[0].length);
    }
    let count = 1;
    let spec: SubstituentSpec | null = null;
    let text = "";
    const direct = SUBSTITUENT_NAMES.find((name) => rest.startsWith(name));
    const multMatch = /^(di|tri|tetra|penta|bis|tris)/.exec(rest);
    const afterMult = multMatch ? rest.slice(multMatch[0].length) : rest;
    const multName = multMatch ? SUBSTITUENT_NAMES.find((name) => afterMult.startsWith(name)) : undefined;
    if (direct && (!multMatch || direct.length >= (multMatch[0].length + (multName?.length ?? 0)))) {
      spec = SUBSTITUENTS[direct]!;
      text = direct;
      rest = rest.slice(direct.length);
    } else if (multMatch && afterMult.startsWith("(")) {
      count = MULTIPLIERS[multMatch[1]!]!;
      const inner = readParenthesised(afterMult);
      if (!inner) return null;
      spec = complexSubstituent(inner.inner);
      if (!spec) return null;
      text = inner.inner;
      rest = inner.rest;
    } else if (multMatch && multName) {
      count = MULTIPLIERS[multMatch[1]!]!;
      spec = SUBSTITUENTS[multName]!;
      text = multName;
      rest = afterMult.slice(multName.length);
    } else if (rest.startsWith("(")) {
      const inner = readParenthesised(rest);
      if (!inner) return null;
      spec = complexSubstituent(inner.inner);
      if (!spec) return null;
      text = inner.inner;
      rest = inner.rest;
    } else {
      return null;
    }
    const ompPair = locants.length === 1 && count === 2 && omp(locants[0]!) !== null;
    if (locants.length > 0 && locants.length !== count && !ompPair) return null;
    items.push({ locants, count, spec, text });
  }
  return items;
}

function readParenthesised(text: string): { inner: string; rest: string } | null {
  if (!text.startsWith("(")) return null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(1, i), rest: text.slice(i + 1) };
    }
  }
  return null;
}

/**
 * A complex substituent written in parentheses: "1-methylethyl",
 * "2-methylpropyl", "1,1-dimethylethyl", "butan-2-yl", "prop-2-enyl".
 * Locant 1 of the substituent chain is the attachment point unless a
 * "-n-yl" locant says otherwise.
 */
function complexSubstituent(text: string): SubstituentSpec | null {
  const direct = SUBSTITUENTS[text];
  if (direct) return direct;
  const match = new RegExp(`^(.*?)(cyclo)?(${STEM_PATTERN})((?:a?-?\\d+(?:,\\d+)*-?(?:di|tri)?(?:en|yn))*)(?:an)?-?(\\d+)?-?yl$`).exec(text);
  if (!match) return null;
  const [, prefixText, cyclo, stem, unsatText, attachText] = match;
  const length = STEMS[stem!]!;
  const chain = buildChain(length, Boolean(cyclo));
  if (!chain) return null;
  const unsaturation = unsatText ? parseUnsaturation(unsatText, length, Boolean(cyclo)) : [];
  if (unsaturation === null) return null;
  let molecule: Molecule | null = chain;
  for (const item of unsaturation) {
    molecule = setBondOrder(molecule, item.from, item.to, item.order);
    if (!molecule) return null;
  }
  const attach = attachText ? Number(attachText) : 1;
  if (attach < 1 || attach > length) return null;
  const prefixes = parsePrefixes(prefixText ?? "");
  if (!prefixes) return null;
  for (const item of prefixes) {
    const locants = item.locants.length > 0 ? item.locants.map(Number) : (length === 1 ? Array(item.count).fill(1) as number[] : null);
    if (!locants) return null;
    for (const locant of locants) {
      if (!Number.isInteger(locant) || locant < 1 || locant > length) return null;
      molecule = attachSpec(molecule, locant - 1, item.spec);
      if (!molecule) return null;
    }
  }
  if (!valenceOk(molecule)) return null;
  return { fragment: molecule, attach: attach - 1, order: 1 };
}

function attachSpec(molecule: Molecule, atom: number, spec: SubstituentSpec): Molecule | null {
  if (spec.fragment) return attachMolecule(molecule, atom, spec.fragment, spec.attach ?? 0, spec.order ?? 1);
  if (!spec.smiles) return null;
  const fragment = parseSmiles(spec.smiles);
  if (!fragment) return null;
  return attachMolecule(molecule, atom, fragment, 0, spec.order ?? 1);
}

function buildChain(length: number, cyclo: boolean): Molecule | null {
  if (length < 1) return null;
  if (cyclo && length < 3) return null;
  const smiles = cyclo ? `C1${"C".repeat(length - 1)}1` : "C".repeat(length);
  return parseSmiles(smiles);
}

interface UnsaturationBond { from: number; to: number; order: BondOrder }

/**
 * "-2-en", "a-1,3-dien", "-1-en-3-yn": bonds by zero-based atom index.
 * Returns [] for saturated ("an" or nothing) and null when malformed or when
 * a locant is missing where the parent leaves it ambiguous.
 */
function parseUnsaturation(text: string, length: number, cyclo: boolean): UnsaturationBond[] | null {
  let rest = text;
  // Every parent writes "an", "en" or "yn"; an empty token ("none", "decal") is not a name.
  if (!rest) return null;
  if (/^a(?=-|\d)/.test(rest)) rest = rest.slice(1);
  const bonds: UnsaturationBond[] = [];
  const pattern = /^-?(\d+(?:,\d+)*)?-?(di|tri|tetra)?(an|en|yn)/;
  let guard = 0;
  while (rest.length > 0) {
    guard += 1;
    if (guard > 8) return null;
    const match = pattern.exec(rest);
    if (!match) return null;
    rest = rest.slice(match[0].length);
    const kind = match[3]!;
    const count = match[2] ? MULTIPLIERS[match[2]]! : 1;
    if (kind === "an") {
      if (match[1] || match[2] || text.length !== match[0].length) return null;
      return [];
    }
    let locants = match[1] ? parseLocantList(match[1]).map(Number) : [];
    if (locants.length === 0) {
      if (count === 1 && (length <= 3 || cyclo)) locants = [1];
      else if (count === 2 && cyclo && length === 5 && kind === "en") locants = [1, 3];
      else return null;
    }
    if (locants.length !== count) return null;
    for (const locant of locants) {
      if (!Number.isInteger(locant) || locant < 1) return null;
      const from = locant - 1;
      const to = cyclo ? locant % length : locant;
      if (to >= length || from >= length) return null;
      bonds.push({ from, to, order: kind === "en" ? 2 : 3 });
    }
  }
  return bonds;
}

function setBondOrder(molecule: Molecule, a: number, b: number, order: BondOrder): Molecule | null {
  const bond = molecule.bonds.find((entry) => (entry.a === a && entry.b === b) || (entry.a === b && entry.b === a));
  if (!bond || bond.order !== 1) return null;
  bond.order = order;
  return attachMolecule(molecule, 0, null, 0, 1);
}

const SUFFIX_PATTERN = /^(.*?)e?(?:-?(\d+(?:,\d+)*)-?)?(di|tri|tetra)?(oic acid|oyl chloride|oyl bromide|carboxylic acid|carbaldehyde|carbonitrile|carboxamide|sulphonic acid|sulfonic acid|nitrile|amine|amide|thiol|oate|one|ol|al)$/;

interface ParentParse {
  molecule: Molecule;
  /** Chain atoms that carry the principal group, for N-locants and ester oxygens. */
  marks: { amineN: number[]; amideN: number[]; acidO: number[] };
  length: number;
  cyclo: boolean;
}

/**
 * Parse a chain or ring parent with its unsaturation and principal suffix:
 * "butan-2-ol", "buta-1,3-diene", "cyclohexanone", "hexanedioic acid".
 * `dangling` carries American-style locants written before the parent
 * ("2-butene", "1-propanol"), assigned to the first item lacking them.
 */
function parseChainParent(parent: string, dangling: string[]): ParentParse | null {
  const head = new RegExp(`^(cyclo)?(${STEM_PATTERN})(.*)$`).exec(parent);
  if (!head) return null;
  const cyclo = Boolean(head[1]);
  const length = STEMS[head[2]!]!;
  let rest = head[3]!;
  let suffixKind: string | null = null;
  let suffixLocants: number[] = [];
  let suffixCount = 1;
  const suffix = SUFFIX_PATTERN.exec(rest);
  if (suffix) {
    suffixKind = suffix[4]!;
    suffixCount = suffix[3] ? MULTIPLIERS[suffix[3]]! : 1;
    suffixLocants = suffix[2] ? parseLocantList(suffix[2]).map(Number) : [];
    rest = suffix[1]!;
  } else {
    if (!rest.endsWith("e")) return null;
    rest = rest.slice(0, -1);
  }
  // Hydrocarbon parents write the vowel: "butane", "but-2-ene". With a
  // suffix the "e" is elided ("butan-2-ol") or kept ("butanenitrile").
  let unsatText = rest;
  let pending = [...dangling];
  // Dangling locants first fill an unsaturation item written without them.
  unsatText = unsatText.replace(/^(a?)(-?)(di|tri|tetra)?(en|yn)(?=$|-)/, (whole, a: string, hyphen: string, mult: string | undefined, kind: string) => {
    if (pending.length === 0) return whole;
    const need = mult ? MULTIPLIERS[mult]! : 1;
    if (pending.length !== need) return whole;
    const locs = pending.join(",");
    pending = [];
    return `${a}-${locs}-${mult ?? ""}${kind}`;
  });
  const unsaturation = parseUnsaturation(unsatText, length, cyclo);
  if (unsaturation === null) return null;
  if (suffixKind && suffixLocants.length === 0 && pending.length > 0) {
    suffixLocants = pending.map(Number);
    pending = [];
  }
  if (pending.length > 0) return null;
  let molecule = buildChain(length, cyclo);
  if (!molecule) return null;
  for (const item of unsaturation) {
    molecule = setBondOrder(molecule, item.from, item.to, item.order);
    if (!molecule) return null;
  }
  const marks = { amineN: [] as number[], amideN: [] as number[], acidO: [] as number[] };
  if (suffixKind) {
    const resolved = resolveSuffixLocants(suffixKind, suffixLocants, suffixCount, length, cyclo);
    if (!resolved) return null;
    for (const locant of resolved) {
      const atom = locant - 1;
      const before = molecule.atoms.length;
      switch (suffixKind) {
        case "ol": molecule = attachSpec(molecule, atom, { smiles: "O" }); break;
        case "thiol": molecule = attachSpec(molecule, atom, { smiles: "S" }); break;
        case "al": molecule = attachSpec(molecule, atom, { smiles: "O", order: 2 }); break;
        case "one": molecule = attachSpec(molecule, atom, { smiles: "O", order: 2 }); break;
        case "oic acid": {
          molecule = attachSpec(molecule, atom, { smiles: "O", order: 2 });
          if (!molecule) return null;
          molecule = attachSpec(molecule, atom, { smiles: "O" });
          if (molecule) marks.acidO.push(molecule.atoms.length - 1);
          break;
        }
        case "oate": {
          molecule = attachSpec(molecule, atom, { smiles: "O", order: 2 });
          if (!molecule) return null;
          molecule = attachSpec(molecule, atom, { smiles: "O" });
          if (molecule) marks.acidO.push(molecule.atoms.length - 1);
          break;
        }
        case "oyl chloride": {
          molecule = attachSpec(molecule, atom, { smiles: "O", order: 2 });
          if (!molecule) return null;
          molecule = attachSpec(molecule, atom, { smiles: "Cl" });
          break;
        }
        case "oyl bromide": {
          molecule = attachSpec(molecule, atom, { smiles: "O", order: 2 });
          if (!molecule) return null;
          molecule = attachSpec(molecule, atom, { smiles: "Br" });
          break;
        }
        case "amine": molecule = attachSpec(molecule, atom, { smiles: "N" }); if (molecule) marks.amineN.push(before); break;
        case "amide": {
          molecule = attachSpec(molecule, atom, { smiles: "O", order: 2 });
          if (!molecule) return null;
          molecule = attachSpec(molecule, atom, { smiles: "N" });
          if (molecule) marks.amideN.push(molecule.atoms.length - 1);
          break;
        }
        case "nitrile": molecule = attachSpec(molecule, atom, { smiles: "N", order: 3 }); break;
        case "carboxylic acid": {
          molecule = attachSpec(molecule, atom, { smiles: "C(=O)O" });
          if (molecule) marks.acidO.push(molecule.atoms.length - 1);
          break;
        }
        case "carbaldehyde": molecule = attachSpec(molecule, atom, { smiles: "C=O" }); break;
        case "carbonitrile": molecule = attachSpec(molecule, atom, { smiles: "C#N" }); break;
        case "carboxamide": molecule = attachSpec(molecule, atom, { smiles: "C(N)=O" }); if (molecule) marks.amideN.push(before + 1); break;
        case "sulphonic acid":
        case "sulfonic acid": molecule = attachSpec(molecule, atom, { smiles: "S(=O)(=O)O" }); break;
        default: return null;
      }
      if (!molecule) return null;
    }
  }
  return { molecule, marks, length, cyclo };
}

/** Where a principal suffix sits when the name omits its locant. */
function resolveSuffixLocants(kind: string, locants: number[], count: number, length: number, cyclo: boolean): number[] | null {
  if (locants.length > 0) {
    if (locants.length !== count) return null;
    if (locants.some((locant) => locant < 1 || locant > length)) return null;
    if (["al", "oic acid", "amide", "nitrile", "oyl chloride", "oyl bromide", "oate"].includes(kind) && !cyclo) {
      const ends = count === 1 ? [1] : [1, length];
      if (locants.some((locant) => !ends.includes(locant))) return null;
    }
    return locants;
  }
  const terminal = ["al", "oic acid", "amide", "nitrile", "oyl chloride", "oyl bromide", "oate"];
  if (terminal.includes(kind)) {
    if (cyclo) return null;
    if (count === 1) return [1];
    if (count === 2) return [1, length];
    return null;
  }
  if (["carboxylic acid", "carbaldehyde", "carbonitrile", "carboxamide", "sulphonic acid", "sulfonic acid"].includes(kind)) {
    return count === 1 ? [1] : null;
  }
  if (count !== 1) return null;
  if (cyclo) return [1];
  if (kind === "one") return length === 3 || length === 4 ? [2] : null;
  return length <= 2 ? [1] : null;
}

/** Positions for a substituent whose locant the name omits. */
function fillMissingLocants(item: PrefixItem, length: number, cyclo: boolean, ringFixed: readonly number[] | null): number[] | null {
  if (ringFixed) {
    if (item.count !== 1) return null;
    return ringFixed.length === 0 ? [1] : null;
  }
  if (length === 1) return Array(item.count).fill(1) as number[];
  if (length === 2 && item.count === 1) return [1];
  if (cyclo && item.count === 1) return [1];
  const alkyl = /^(methyl|ethyl|propyl|isopropyl|butyl|tertbutyl)$/.test(item.text);
  if (length === 3 && alkyl) return Array(item.count).fill(2) as number[];
  return null;
}

function applyPrefixes(
  molecule: Molecule,
  items: PrefixItem[],
  length: number,
  cyclo: boolean,
  atomFor: (locant: number) => number | null,
  nitrogen: number | null,
  ringFixed: readonly number[] | null,
): Molecule | null {
  let current: Molecule | null = molecule;
  for (const item of items) {
    let locants: number[];
    if (item.locants.length === 0) {
      const filled = fillMissingLocants(item, length, cyclo, ringFixed);
      if (!filled) return null;
      locants = filled;
    } else if (item.locants.every((locant) => locant === "n")) {
      if (nitrogen === null) return null;
      for (let i = 0; i < item.count; i += 1) {
        current = attachSpec(current!, nitrogen, item.spec);
        if (!current) return null;
      }
      continue;
    } else {
      locants = [];
      for (const raw of item.locants) {
        const relative = omp(raw);
        if (relative !== null) {
          if (!ringFixed) return null;
          if (item.count === 2 && ringFixed.length === 0) { locants.push(1, relative); break; }
          if (item.count !== 1) return null;
          locants.push(relative);
        } else {
          const value = Number(raw);
          if (!Number.isInteger(value)) return null;
          locants.push(value);
        }
      }
    }
    if (locants.length !== item.count) return null;
    for (const locant of locants) {
      if (ringFixed && ringFixed.includes(locant)) return null;
      const atom = atomFor(locant);
      if (atom === null) return null;
      current = attachSpec(current!, atom, item.spec);
      if (!current) return null;
    }
  }
  return current;
}

/** Split "prefixes+parent" at the earliest position where the remainder is a chain parent. */
function splitChainName(text: string): { prefix: string; dangling: string[]; parent: ParentParse } | null {
  const pattern = new RegExp(`(cyclo)?(${STEM_PATTERN})`, "g");
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    const candidate = text.slice(start);
    let prefix = text.slice(0, start);
    let dangling: string[] = [];
    const danglingMatch = /(?:^|-)(\d+(?:,\d+)*)-$/.exec(prefix);
    if (danglingMatch) {
      dangling = parseLocantList(danglingMatch[1]!);
      prefix = prefix.slice(0, prefix.length - danglingMatch[0].length + (danglingMatch[0].startsWith("-") ? 1 : 0));
    }
    const parent = parseChainParent(candidate, dangling);
    if (parent) return { prefix, dangling, parent };
  }
  return null;
}

function parseRingName(text: string): Molecule | null {
  const pattern = new RegExp(`^(.*?)(${RING_PARENT_PATTERN})(?:-?(\\d+(?:,\\d+)*)-?(di|tri)?(ol|amine|carboxylic acid|carbaldehyde|carbonitrile|thiol))?$`);
  const match = pattern.exec(text);
  if (!match) return null;
  const [, prefixText, parentName, suffixLocantText, suffixMult, suffixKind] = match;
  let templateName = parentName!;
  let extra: PrefixItem | null = null;
  let prefix = prefixText ?? "";
  const derived = DERIVED_RING_PARENTS[parentName!];
  if (derived) {
    templateName = derived.template;
    // The derived parent's own second group takes the o/m/p or numeric locant that precedes it.
    const locantMatch = /(?:^|-)(\d|[omp])-$/.exec(prefix);
    if (!locantMatch) return null;
    prefix = prefix.slice(0, prefix.length - locantMatch[0].length + (locantMatch[0].startsWith("-") ? 1 : 0));
    extra = { locants: [locantMatch[1]!], count: 1, spec: SUBSTITUENTS[derived.group]!, text: derived.group };
  }
  const template = RING_TEMPLATES[templateName];
  if (!template) return null;
  let molecule = parseSmiles(template.smiles);
  if (!molecule) return null;
  const ringSize = template.ring.length;
  const atomFor = (locant: number): number | null => {
    if (locant < 1 || locant > ringSize) return null;
    const atom = template.ring[locant - 1]!;
    return atom < 0 ? null : atom;
  };
  if (suffixKind) {
    if (template.fixed.length > 0) return null;
    const count = suffixMult ? MULTIPLIERS[suffixMult]! : 1;
    const locants = suffixLocantText ? parseLocantList(suffixLocantText).map(Number) : (count === 1 ? [1] : null);
    if (!locants || locants.length !== count) return null;
    const fixed: number[] = [];
    for (const locant of locants) {
      const atom = atomFor(locant);
      if (atom === null) return null;
      const spec = suffixKind === "ol" ? { smiles: "O" } : suffixKind === "amine" ? { smiles: "N" } : suffixKind === "thiol" ? { smiles: "S" }
        : suffixKind === "carboxylic acid" ? { smiles: "C(=O)O" } : suffixKind === "carbaldehyde" ? { smiles: "C=O" } : { smiles: "C#N" };
      molecule = attachSpec(molecule, atom, spec);
      if (!molecule) return null;
      fixed.push(locant);
    }
    return finishRing(molecule, prefix, template, fixed, null, text);
  }
  const fixed = [...template.fixed];
  if (extra) {
    const relative = omp(extra.locants[0]!) ?? Number(extra.locants[0]);
    if (fixed.includes(relative)) return null;
    const atom = atomFor(relative);
    if (atom === null) return null;
    molecule = attachSpec(molecule, atom, extra.spec);
    if (!molecule) return null;
    fixed.push(relative);
    if (fixed.length === 1) fixed.unshift(1);
  }
  return finishRing(molecule, prefix, template, fixed, template.nitrogen ?? null, text);
}

function finishRing(
  molecule: Molecule,
  prefix: string,
  template: RingTemplate,
  fixed: number[],
  nitrogen: number | null,
  text: string,
): Molecule | null {
  const items = parsePrefixes(prefix);
  if (!items) return null;
  const atomFor = (locant: number): number | null => {
    if (locant < 1 || locant > template.ring.length) return null;
    const atom = template.ring[locant - 1]!;
    return atom < 0 ? null : atom;
  };
  const result = applyPrefixes(molecule, items, template.ring.length, true, atomFor, nitrogen, fixed);
  if (!result || !valenceOk(result)) return null;
  result.name = text;
  return result;
}

function parseAlkylGroup(text: string): Molecule | null {
  const smiles = ALKYL_GROUPS[text];
  if (smiles) return parseSmiles(smiles);
  const complex = complexSubstituent(text);
  return complex?.fragment ?? null;
}

/** Radicofunctional and ester names: "ethyl ethanoate", "tert-butyl alcohol", "diethyl ether", "acetyl chloride". */
function parseFunctionalClassName(text: string): Molecule | null {
  const ester = /^([a-z]+) (.+?)(oate|acetate|formate|benzoate|propionate|butyrate)$/.exec(text);
  if (ester) {
    const alkyl = parseAlkylGroup(ester[1]!);
    if (!alkyl) return null;
    const acidPart = ester[3] === "oate" ? `${ester[2]}oic acid`
      : ester[3] === "acetate" ? `${ester[2]}ethanoic acid`
        : ester[3] === "formate" ? `${ester[2]}methanoic acid`
          : ester[3] === "benzoate" ? `${ester[2]}benzoic acid`
            : ester[3] === "propionate" ? `${ester[2]}propanoic acid` : `${ester[2]}butanoic acid`;
    const acid = acidPart.endsWith("benzoic acid") ? parseRingName(acidPart) : parseSubstitutedChain(acidPart);
    if (!acid) return null;
    const acidO = acidPart.endsWith("benzoic acid") ? 0 : (acid as Molecule & { acidO?: number[] }).acidO?.[0];
    if (acidO === undefined) return null;
    const joined = attachMolecule(acid, acidO, alkyl, 0, 1);
    if (!joined || !valenceOk(joined)) return null;
    joined.name = text;
    return joined;
  }
  const acyl = /^(.+?)(oyl|yl) (chloride|bromide)$/.exec(text);
  if (acyl && !/^(?:methyl|ethyl|propyl|isopropyl|butyl|isobutyl|secbutyl|tertbutyl|pentyl|hexyl|vinyl|allyl|benzyl|phenyl|cyclohexyl|cyclopentyl|cyclopropyl)$/.test(`${acyl[1]}${acyl[2]}`)) {
    const acylName = `${acyl[1]}${acyl[2]}`;
    const known = ACYL_GROUPS[acylName];
    if (known) {
      const molecule = parseSmiles(known);
      if (!molecule) return null;
      const joined = attachSpec(molecule, 0, { smiles: acyl[3] === "chloride" ? "Cl" : "Br" });
      if (!joined || !valenceOk(joined)) return null;
      joined.name = text;
      return joined;
    }
    if (acyl[2] === "oyl") {
      const parsed = parseSubstitutedChain(`${acyl[1]}oyl ${acyl[3]}`);
      if (parsed) { parsed.name = text; return parsed; }
    }
    return null;
  }
  const radico = /^([a-z]+) (chloride|bromide|iodide|fluoride|alcohol|cyanide|isocyanide|amine)$/.exec(text);
  if (radico) {
    const group = parseAlkylGroup(radico[1]!);
    if (!group) return null;
    const functional: Record<string, string> = { chloride: "Cl", bromide: "Br", iodide: "I", fluoride: "F", alcohol: "O", cyanide: "C#N", isocyanide: "[N+]#[C-]", amine: "N" };
    const joined = attachSpec(group, 0, { smiles: functional[radico[2]!]! });
    if (!joined || !valenceOk(joined)) return null;
    joined.name = text;
    return joined;
  }
  const amine = /^(di|tri)?([a-z]+?)amine$/.exec(text);
  if (amine && ALKYL_GROUPS[amine[2]!]) {
    const count = amine[1] ? MULTIPLIERS[amine[1]]! : 1;
    let molecule = parseSmiles("N");
    for (let i = 0; i < count && molecule; i += 1) molecule = attachSpec(molecule, 0, { smiles: ALKYL_GROUPS[amine[2]!]! });
    if (!molecule || !valenceOk(molecule)) return null;
    molecule.name = text;
    return molecule;
  }
  const symmetric = /^(di)([a-z]+) (ether|ketone|sulphide|sulfide)$/.exec(text);
  if (symmetric && ALKYL_GROUPS[symmetric[2]!]) {
    const core = symmetric[3] === "ether" ? "O" : symmetric[3] === "ketone" ? "C=O" : "S";
    let molecule = parseSmiles(core);
    for (let i = 0; i < 2 && molecule; i += 1) molecule = attachSpec(molecule, 0, { smiles: ALKYL_GROUPS[symmetric[2]!]! });
    if (!molecule || !valenceOk(molecule)) return null;
    molecule.name = text;
    return molecule;
  }
  const mixed = /^([a-z]+) ([a-z]+) (ether|ketone|sulphide|sulfide)$/.exec(text);
  if (mixed && ALKYL_GROUPS[mixed[1]!] && ALKYL_GROUPS[mixed[2]!]) {
    const core = mixed[3] === "ether" ? "O" : mixed[3] === "ketone" ? "C=O" : "S";
    let molecule = parseSmiles(core);
    molecule = molecule && attachSpec(molecule, 0, { smiles: ALKYL_GROUPS[mixed[1]!]! });
    molecule = molecule && attachSpec(molecule, 0, { smiles: ALKYL_GROUPS[mixed[2]!]! });
    if (!molecule || !valenceOk(molecule)) return null;
    molecule.name = text;
    return molecule;
  }
  return null;
}

/** "2-chloro-2-methylpropane", "butan-2-ol", "n,n-dimethylethanamine": prefixes on a chain parent. */
function parseSubstitutedChain(text: string): (Molecule & { acidO?: number[] }) | null {
  const split = splitChainName(text);
  if (!split) return null;
  const { prefix, parent } = split;
  const items = parsePrefixes(prefix);
  if (!items) return null;
  const nitrogen = parent.marks.amineN[0] ?? parent.marks.amideN[0] ?? null;
  if ((parent.marks.amineN.length + parent.marks.amideN.length) > 1 && items.some((item) => item.locants.includes("n"))) return null;
  const atomFor = (locant: number): number | null => (locant >= 1 && locant <= parent.length ? locant - 1 : null);
  const result = applyPrefixes(parent.molecule, items, parent.length, parent.cyclo, atomFor, nitrogen, null);
  if (!result || !valenceOk(result)) return null;
  result.name = text;
  return Object.assign(result, { acidO: parent.marks.acidO });
}

const STEREO_PREFIX = /^(cis|trans|\(e\)|\(z\)|e|z)-/;

/**
 * A molecule from a name, or null. Catalog names first, then systematic
 * names. A "cis-"/"trans-" prefix is honoured on a disubstituted alkene;
 * "(E)/(Z)" only when the alkene is symmetric enough that they coincide.
 */
export function moleculeFromName(raw: string): Molecule | null {
  const normalized = normalizeName(raw);
  if (!normalized) return null;
  const full = catalogLookup(normalized);
  if (full) return full;
  let stereo: "cis" | "trans" | null = null;
  let text = normalized;
  const stereoMatch = STEREO_PREFIX.exec(text);
  if (stereoMatch) {
    const tag = stereoMatch[1]!;
    stereo = tag === "cis" || tag === "(z)" || tag === "z" ? "cis" : "trans";
    text = text.slice(stereoMatch[0].length);
  }
  let molecule: Molecule | null = catalogLookup(text);
  if (!molecule) molecule = parseFunctionalClassName(text);
  if (!molecule) molecule = parseRingName(text);
  if (!molecule) molecule = parseSubstitutedChain(text);
  if (!molecule) return null;
  if (!valenceOk(molecule)) return null;
  if (stereo) {
    if (!applyStereo(molecule, stereo, stereoMatch![1]!)) return null;
    molecule.name = `${stereo}-${molecule.name ?? text}`;
  }
  return molecule;
}

/**
 * Mark the one eligible C=C so the layout draws the asked geometry. Only
 * a double bond outside a ring whose ends each carry exactly one heavy
 * substituent qualifies; E/Z are accepted only when both substituents are
 * the same, so E means trans without a priority ranking.
 */
function applyStereo(molecule: Molecule, stereo: "cis" | "trans", tag: string): boolean {
  const candidates = molecule.bonds.filter((bond) => bond.order === 2
    && molecule.atoms[bond.a]!.element === "C" && molecule.atoms[bond.b]!.element === "C"
    && !bond.aromatic);
  const eligible = candidates.filter((bond) => {
    const sideA = molecule.bonds.filter((other) => other !== bond && (other.a === bond.a || other.b === bond.a));
    const sideB = molecule.bonds.filter((other) => other !== bond && (other.a === bond.b || other.b === bond.b));
    return sideA.length === 1 && sideB.length === 1;
  });
  if (eligible.length !== 1) return false;
  const bond = eligible[0]!;
  if (bond.direction) return false;
  const isEZ = tag !== "cis" && tag !== "trans";
  const subA = molecule.bonds.find((other) => other !== bond && (other.a === bond.a || other.b === bond.a))!;
  const subB = molecule.bonds.find((other) => other !== bond && (other.a === bond.b || other.b === bond.b))!;
  const atomA = subA.a === bond.a ? subA.b : subA.a;
  const atomB = subB.a === bond.b ? subB.b : subB.a;
  if (isEZ && molecule.atoms[atomA]!.element !== molecule.atoms[atomB]!.element) return false;
  molecule.stereo = { bond: bond.index, kind: stereo };
  return true;
}

export type { Molecule };
